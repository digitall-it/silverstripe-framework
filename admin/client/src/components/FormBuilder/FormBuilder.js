import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import * as formActions from 'state/form/FormActions';
import * as schemaActions from 'state/schema/SchemaActions';
import SilverStripeComponent from 'lib/SilverStripeComponent';
import Form from 'components/Form/Form';
import FormAction from 'components/FormAction/FormAction';
import fetch from 'isomorphic-fetch';
import deepFreeze from 'deep-freeze-strict';
import backend from 'lib/Backend';
import injector from 'lib/Injector';
import merge from 'merge';

import es6promise from 'es6-promise';
es6promise.polyfill();

export class FormBuilderComponent extends SilverStripeComponent {

  constructor(props) {
    super(props);

    this.formSchemaPromise = null;
    this.state = { isFetching: false };

    this.mapActionsToComponents = this.mapActionsToComponents.bind(this);
    this.mapFieldsToComponents = this.mapFieldsToComponents.bind(this);
    this.handleFieldUpdate = this.handleFieldUpdate.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.removeForm = this.removeForm.bind(this);
    this.getFormId = this.getFormId.bind(this);
    this.getFormSchema = this.getFormSchema.bind(this);
  }

  /**
   * Get the schema for this form
   *
   * @returns {array}
   */
  getFormSchema() {
    return this.props.schemas[this.props.schemaUrl];
  }

  /**
   * Gets the ID for this form
   *
   * @returns {string}
   */
  getFormId() {
    const schema = this.getFormSchema();
    if (schema) {
      return schema.id;
    }
    return null;
  }

  componentDidMount() {
    this.fetch();
  }

  /**
   * Fetches data used to generate a form. This can be form schema and or form state data.
   * When the response comes back the data is saved to state.
   *
   * @param boolean schema - If form schema data should be returned in the response.
   * @param boolean state - If form state data should be returned in the response.
   *
   * @return object - Promise from the AJAX request.
   */
  fetch(schema = true, state = true) {
    const headerValues = [];

    if (this.state.isFetching === true) {
      return this.formSchemaPromise;
    }

    if (schema === true) {
      headerValues.push('schema');
    }

    if (state === true) {
      headerValues.push('state');
    }

    this.formSchemaPromise = fetch(this.props.schemaUrl, {
      headers: { 'X-FormSchema-Request': headerValues.join() },
      credentials: 'same-origin',
    })
      .then(response => response.json())
      .then(json => {
        const formSchema = Object.assign({}, { id: json.id, schema: json.schema });
        const formState = Object.assign({}, json.state);

        // TODO See "Enable once <CampaignAdmin> ..." below
        // this.setState({ isFetching: false });

        if (typeof formSchema.id !== 'undefined') {
          const defaultData = {
            SecurityID: this.props.config.SecurityID,
          };

          if (formSchema.schema.actions.length > 0) {
            defaultData[formSchema.schema.actions[0].name] = 1;
          }

          this.submitApi = backend.createEndpointFetcher({
            url: formSchema.schema.attributes.action,
            method: formSchema.schema.attributes.method,
            defaultData,
          });

          this.props.schemaActions.setSchema(formSchema);
        }

        if (typeof formState.id !== 'undefined') {
          this.props.formActions.addForm(formState);
        }
      });

    // TODO Enable once <CampaignAdmin> is initialised via page.js route callbacks
    // At the moment, it's running an Entwine onadd() rule which ends up
    // rendering the index view, and only then calling route.start() to
    // match the detail view (admin/campaigns/set/:id/show).
    // This causes the form builder to be unmounted during a fetch() call.
    // this.setState({ isFetching: true });

    return this.formSchemaPromise;
  }

  /**
   * Update handler passed down to each form field as a prop.
   * Form fields call this method when their state changes.
   *
   * You can pass an optional callback as the third param. This can be used to
   * implement custom behaviour. For example you can use `createFn` hook from
   * your controller context like this.
   *
   * controller.js
   * ...
   * detailEditFormCreateFn(Component, props) {
   *   const extendedProps = Object.assign({}, props, {
   *     handleFieldUpdate: (event, updates) => {
   *       props.handleFieldUpdate(event, updates, (formId, updateFieldAction) => {
   *         const customUpdates = Object.assign({}, updates, {
   *           value: someCustomParsing(updates.value),
   *         };
   *
   *         updateFieldAction(formId, customUpdates);
   *       });
   *     },
   *   });
   *
   *   return <Component {...extendedProps} />;
   * }
   * ...
   *
   * @param {object} event - Change event from the form field component.
   * @param {object} updates - Values to set in state.
   * @param {string} updates.id - Field ID. Required to identify the field in the store.
   * @param {function} [fn] - Optional function for custom behaviour. See example in description.
   */
  handleFieldUpdate(event, updates, fn) {
    if (typeof fn !== 'undefined') {
      fn(this.getFormId(), this.props.formActions.updateField);
    } else {
      this.props.formActions.updateField(this.getFormId(), updates);
    }
  }

  /**
   * Form submission handler passed to the Form Component as a prop.
   * Provides a hook for controllers to access for state and provide custom functionality.
   *
   * For example:
   *
   * controller.js
   * ```
   * constructor(props) {
   *   super(props);
   *   this.handleSubmit = this.handleSubmit.bind(this);
   * }
   *
   * handleSubmit(event, fieldValues, submitFn) {
   *   event.preventDefault();
   *
   *   // Apply custom validation.
   *   if (!this.validate(fieldValues)) {
   *     return;
   *   }
   *
   *   submitFn();
   * }
   *
   * render() {
   *   return <FormBuilder handleSubmit={this.handleSubmit} />
   * }
   * ```
   *
   * @param {Object} event
   */
  handleSubmit(event) {
    const schemaFields = this.props.schemas[this.props.schemaUrl].schema.fields;
    const fieldValues = this.props.form[this.getFormId()].fields
      .reduce((prev, curr) => Object.assign({}, prev, {
        [schemaFields.find(schemaField => schemaField.id === curr.id).name]: curr.value,
      }), {});

    const submitFn = () => {
      this.props.formActions.submitForm(
        this.submitApi,
        this.getFormId(),
        fieldValues
      );
    };

    if (typeof this.props.handleSubmit !== 'undefined') {
      this.props.handleSubmit(event, fieldValues, submitFn);
      return;
    }

    event.preventDefault();
    submitFn();
  }

  /**
   * Maps a list of schema fields to their React Component.
   * Only top level form fields are handled here, composite fields (TabSets etc),
   * are responsible for mapping and rendering their children.
   *
   * @param array fields
   *
   * @return array
   */
  mapFieldsToComponents(fields) {
    const createFn = this.props.createFn;
    const handleFieldUpdate = this.handleFieldUpdate;

    return fields.map((field, i) => {
      const Component = field.component !== null
        ? injector.getComponentByName(field.component)
        : injector.getComponentByDataType(field.type);

      if (Component === null) {
        return null;
      }

      // Props which every form field receives.
      // Leave it up to the schema and component to determine
      // which props are required.
      const props = Object.assign({}, field, { onChange: handleFieldUpdate });

      // Provides container components a place to hook in
      // and apply customisations to scaffolded components.
      if (typeof createFn === 'function') {
        return createFn(Component, props);
      }

      return <Component key={i} {...props} />;
    });
  }

  /**
   * Maps a list of form actions to their React Component.
   *
   * @param array actions
   *
   * @return array
   */
  mapActionsToComponents(actions) {
    const createFn = this.props.createFn;
    const form = this.props.form[this.getFormId()];

    return actions.map((action, i) => {
      let props = deepFreeze(action);

      // Add sensible defaults for common actions.
      switch (props.name) {
        case 'action_save':
          props = deepFreeze(Object.assign({}, {
            type: 'submit',
            label: props.title,
            icon: 'save',
            loading: typeof form !== 'undefined' ? form.submitting : false,
            bootstrapButtonStyle: 'primary',
          }, props));
          break;
        case 'action_cancel':
          props = deepFreeze(Object.assign({}, {
            type: 'button',
            label: props.title,
          }, props));
          break;
        default:
          break;
      }

      if (typeof createFn === 'function') {
        return createFn(FormAction, props);
      }

      return <FormAction key={i} {...props} />;
    });
  }

  /**
   * Merges the structural and state data of a form field.
   * The structure of the objects being merged should match the structures
   * generated by the SilverStripe FormSchema.
   *
   * @param {object} structure - Structural data for a single field.
   * @param {object} state - State data for a single field.
   * @return {object}
   */
  mergeFieldData(structure, state) {
    return merge.recursive(true, structure, {
      data: state.data,
      messages: state.messages,
      valid: state.valid,
      value: state.value,
    });
  }

  /**
   * Cleans up Redux state used by the form when the Form component is unmonuted.
   *
   * @param {string} formId - ID of the form to clean up.
   */
  removeForm(formId) {
    this.props.formActions.removeForm(formId);
  }

  render() {
    const formId = this.getFormId();
    if (!formId) {
      return null;
    }
    const formSchema = this.getFormSchema();
    const formState = this.props.form[formId];

    // If the response from fetching the initial data
    // hasn't come back yet, don't render anything.
    if (!formSchema) {
      return null;
    }

    // Map form schema to React component attribute names,
    // which requires renaming some of them (by unsetting the original keys)
    const attributes = Object.assign({}, formSchema.schema.attributes, {
      class: null,
      className: formSchema.schema.attributes.class,
      enctype: null,
      encType: formSchema.schema.attributes.enctype,
    });

    // If there is structural and state data availabe merge those data for each field.
    // Otherwise just use the structural data.
    const fieldData = formSchema.schema && formState && formState.fields
      ? formSchema.schema.fields.map((f, i) => this.mergeFieldData(f, formState.fields[i]))
      : formSchema.schema.fields;

    const formProps = {
      actions: formSchema.schema.actions,
      attributes,
      componentWillUnmount: this.removeForm,
      data: formSchema.schema.data,
      fields: fieldData,
      formId,
      handleSubmit: this.handleSubmit,
      mapActionsToComponents: this.mapActionsToComponents,
      mapFieldsToComponents: this.mapFieldsToComponents,
    };

    return <Form {...formProps} />;
  }
}

FormBuilderComponent.propTypes = {
  config: React.PropTypes.object,
  createFn: React.PropTypes.func,
  form: React.PropTypes.object.isRequired,
  formActions: React.PropTypes.object.isRequired,
  handleSubmit: React.PropTypes.func,
  schemas: React.PropTypes.object.isRequired,
  schemaActions: React.PropTypes.object.isRequired,
  schemaUrl: React.PropTypes.string.isRequired,
};

function mapStateToProps(state) {
  return {
    config: state.config,
    form: state.form,
    schemas: state.schemas,
  };
}

function mapDispatchToProps(dispatch) {
  return {
    formActions: bindActionCreators(formActions, dispatch),
    schemaActions: bindActionCreators(schemaActions, dispatch),
  };
}

export default connect(mapStateToProps, mapDispatchToProps)(FormBuilderComponent);
