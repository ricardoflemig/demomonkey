import React from 'react'
import Tabs from '../../shared/Tabs'
import Pane from '../../shared/Pane'
import Variable from './Variable'
import CodeEditor from './CodeEditor'
import Configuration from '../../../models/Configuration'
import Repository from '../../../models/Repository'
import PropTypes from 'prop-types'
import Mousetrap from 'mousetrap'
import showdown from 'showdown'
import Select from 'react-select'
import CommandBuilder from '../../../commands/CommandBuilder'
import ToggleButton from 'react-toggle-button'

class Editor extends React.Component {
  static propTypes = {
    currentConfiguration: PropTypes.object.isRequired,
    repository: PropTypes.instanceOf(Repository).isRequired,
    onSave: PropTypes.func.isRequired,
    onCopy: PropTypes.func.isRequired,
    onDownload: PropTypes.func.isRequired,
    onDelete: PropTypes.func.isRequired,
    autoSave: PropTypes.bool.isRequired,
    saveOnClose: PropTypes.bool.isRequired,
    withTemplateEngine: PropTypes.bool.isRequired,
    editorAutocomplete: PropTypes.bool.isRequired,
    toggleConfiguration: PropTypes.func.isRequired
  }

  constructor(props) {
    super(props)
    this.state = {
      currentConfiguration: props.currentConfiguration,
      unsavedChanges: false
    }
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.props.currentConfiguration.id !== prevProps.currentConfiguration.id) {
      if (prevProps.saveOnClose && prevState.unsavedChanges) {
        prevProps.onSave(prevProps.currentConfiguration, prevState.currentConfiguration)
      }
    }
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (nextProps.currentConfiguration.id !== prevState.currentConfiguration.id) {
      return {
        currentConfiguration: nextProps.currentConfiguration,
        unsavedChanges: false
      }
    }
    return null
  }

  handleUpdate(key, value, event = false) {
    if (event) {
      event.preventDefault()
    }
    var config = this.state.currentConfiguration
    config[key] = value
    this.setState({ currentConfiguration: config, unsavedChanges: true }, function () {
      if (key === 'hotkeys') {
        this.props.onSave(this.props.currentConfiguration, this.state.currentConfiguration)
        this.setState({ unsavedChanges: false })
      }
    })
  }

  updateVariable(name, value) {
    var values = this.state.currentConfiguration.values ? this.state.currentConfiguration.values : {}
    values[name] = value
    this.handleUpdate('values', values)
  }

  toggle() {
    this.props.toggleConfiguration()
  }

  componentDidMount() {
    setInterval(() => {
      var node = document.getElementById('testarea')
      var templateEngineProperties = {
        enabled: this.props.withTemplateEngine,
        variables: {
          location: window.location
        }
      }
      var configuration = new Configuration(this.state.currentConfiguration.content, this.props.repository,
        true, this.state.currentConfiguration.values, templateEngineProperties)

      if (node) {
        configuration.apply(node)
      }
    }, 150)
    Mousetrap.prototype.stopCallback = function (e, element, combo) {
      if (combo === 'mod+s') {
        return false
      }
      if ((' ' + element.className + ' ').indexOf(' mousetrap ') > -1) {
        return false
      }
      return element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA' || (
        element.contentEditable && element.contentEditable === 'true')
    }

    Mousetrap.bind('mod+s', (event) => {
      event.preventDefault()
      this.props.onSave(this.props.currentConfiguration, this.state.currentConfiguration)
      this.setState({ unsavedChanges: false })
      return false
    })
  }

  componentWillUnmount() {
    Mousetrap.unbind('mod+s')
  }

  handleClick(event, action) {
    event.preventDefault()
    if (action === 'save') {
      this.setState({ unsavedChanges: false })
    }
    action = 'on' + action.charAt(0).toUpperCase() + action.substr(1)
    this.props[action](this.props.currentConfiguration, this.state.currentConfiguration)
  }

  _buildRemoteLocation(connector, location) {
    return `https://github.com/${location.user}/${location.repository}/blob/master/${location.path}`
  }

  _buildAnnotations(content) {
    var result = []

    const lines = content.split('\n')

    // Capture namespaces for the command builder.
    const nsPattern = /^@namespace(?:\[\])?\s*=\s*(.*)$/mg
    var match
    var namespaces = []
    while ((match = nsPattern.exec(content))) {
      namespaces.push(match[1])
    }

    const cb = new CommandBuilder(namespaces, [], [])

    lines.forEach((line, rowIdx) => {
      // Process each line and add infos, warnings, errors
      // Multiple = signs can lead to issues, add an info
      if ((line.match(/(?:^=)|(?:[^\\]=)/g) || []).length > 1) {
        result.push({row: rowIdx, column: 0, text: 'Your line contains multiple equals signs (=)!\nThe first will be used to seperate search and replacement.\nQuote the equal signs that are part of your patterns.', type: 'warning'})
      }

      // Check if an imported configuration is available
      if (line.startsWith('+') && line.length > 1 && !this.props.repository.hasByName(line.substring(1))) {
        result.push({row: rowIdx, column: 0, text: `There is no configuration called "${line.substring(1)}", this line will be ignored.`, type: 'warning'})
      }

      if (line.startsWith('!') && line.length > 1) {
        var command = line.split('=')[0].trim()
        var cmd = cb.build(command, null).constructor.name
        if (cmd === 'Command') {
          result.push({row: rowIdx, column: 0, text: `Command "${command}" not found.\nPlease check the spelling and\nif all required namespaces are loaded.`, type: 'error'})
        }
      }

      if ((!line.startsWith(';') && line.includes(';')) || (!line.startsWith('#') && line.includes('#'))) {
        result.push({row: rowIdx, column: 0, text: 'Semi-colon (;) and hash (#) are interpreted as inline comments.\nMake sure to quote your patterns to use them properly.', type: 'info'})
      }
    })

    return result
  }

  render() {
    var current = this.state.currentConfiguration
    var hiddenIfNew = current.id === 'new' ? { display: 'none' } : {}
    var tmpConfig = (new Configuration(current.content, this.props.repository, false, current.values))
    var variables = tmpConfig.getVariables()

    var showTemplateWarning = tmpConfig.isTemplate() || tmpConfig.isRestricted() ? 'no-warning-box' : 'warning-box'
    var showReadOnlyWarning = current.readOnly === true ? 'warning-box' : 'no-warning-box'

    var shortcuts = require('../../../../SHORTCUTS.md')
    var converter = new showdown.Converter({
      'tables': true
    })

    var shortcutsHtml = converter.makeHtml(shortcuts)

    var remoteLocation = current.remoteLocation ? this._buildRemoteLocation(current.connector, current.remoteLocation) : false

    var hotkeyOptions = Array.from(Array(9).keys()).map(x => ({ value: x + 1, label: '#' + (x + 1) }))

    return (
      <div className="editor">
        <div className="title">
          <ToggleButton colors={{active: {base: '#5c832f', hover: '#90c256'}}} value={this.props.currentConfiguration.enabled} onToggle={() => { this.toggle() }} />
          <b>Name</b>
          <input type="text" className="text-input" id="configuration-title" placeholder="Please provide a name. You can use slahes (/) in it to create folders." value={current.name} onChange={(event) => this.handleUpdate('name', event.target.value, event)}/>
          <Select placeholder="Shortcut Groups..." value={current.hotkeys} multi onChange={(options) => this.handleUpdate('hotkeys', options.map(o => o.value), null)} options={hotkeyOptions}/>
          <button className={'save-button ' + (this.state.unsavedChanges ? '' : 'disabled')} onClick={(event) => this.handleClick(event, 'save')}>Save</button>
          <button className="copy-button" style={hiddenIfNew} onClick={(event) => this.handleClick(event, 'copy')}>Duplicate</button>
          <button className="download-button" style={hiddenIfNew} onClick={(event) => this.handleClick(event, 'download')}>Download</button>
          <button className="delete-button" style={hiddenIfNew} onClick={(event) => this.handleClick(event, 'delete')}>Delete</button>
        </div>
        <div className={showTemplateWarning}>
          <b>Warning:</b> Without <b>@include</b> or <b>@exclude</b> defined, your configuration can not be enabled.
         You can only import it as template into another configuration. If this is intended, add <b>@template</b> to remove this warning.
        </div>
        <div className={showReadOnlyWarning}>
          <b>Warning:</b> The configuration you selected is read only.
          { remoteLocation ? <span> Go to <a href={ remoteLocation } target='_blank' rel='noopener noreferrer'>{ remoteLocation }</a> to edit this file</span> : ''}
        </div>
        <Tabs selected={0}>
          <Pane label="Configuration" id="current-configuration-editor">
            <CodeEditor value={current.content}
              onChange={(content) => this.handleUpdate('content', content)}
              readOnly={current.readOnly === true}
              annotations={(content) => this._buildAnnotations(content)}
              onAutoSave={(event) => this.props.autoSave ? this.handleClick(event, 'save') : event.preventDefault() }
              editorAutocomplete={this.props.editorAutocomplete}/>
          </Pane>
          <Pane label="Variables">
            <div className="scrolling-pane">
              {variables.length > 0 ? '' : <div className="no-variables">No variables defined</div>}
              {variables.map((variable, index) => {
                return <Variable key={variable.name} onValueUpdate={(name, value) => this.updateVariable(name, value)} variable={variable}/>
              })}
            </div>
          </Pane>
          <Pane label="Testing">
            <textarea value={current.test} style={{
              width: '100%',
              height: '50%'
            }} onChange={(event) => this.handleUpdate('test', event.target.value)}/>
            <textarea value={current.test} id="testarea" className="read-only" readOnly="readOnly" style={{
              width: '100%',
              height: '50%'
            }}/>
          </Pane>
          <Pane label="Shortcuts">
            <div className="scrolling-pane">
              <div dangerouslySetInnerHTML={{__html: shortcutsHtml}}></div>
            </div>
          </Pane>
        </Tabs>
      </div>
    )
  }
}

export default Editor
