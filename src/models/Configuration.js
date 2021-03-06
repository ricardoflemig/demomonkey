import Ini from './Ini'
import CommandBuilder from '../commands/CommandBuilder'
import Variable from './Variable'
import MatchRule from './MatchRule'

class Configuration {
  constructor(iniFile, repository, enabled = true, values = {}, templateEngineProperties = {}) {
    this.repository = repository
    this.rawContent = iniFile
    this.content = iniFile ? (new Ini(iniFile, repository)).parse(templateEngineProperties) : []
    this.patterns = false
    this.options = false
    this.enabled = enabled
    this.values = values
  }

  isTemplate() {
    return this.getOptions().template
  }

  isDisabled() {
    return this.isTemplate() || this.getOptions().deprecated
  }

  isRestricted() {
    return typeof this.getOptions().include !== 'undefined' || typeof this.getOptions().exclude !== 'undefined'
  }

  updateValues(values) {
    this.values = Object.assign(this.values, values)
    this.patterns = false
    return this
  }

  isAvailableForUrl(url) {
    if (this.isDisabled() || !this.isRestricted()) {
      return false
    }
    var options = this.getOptions()
    return new MatchRule(options.include, options.exclude).test(url)
  }

  isEnabledForUrl(url) {
    if (this.enabled === false || this.isDisabled() || !this.isRestricted()) {
      return false
    }
    var options = this.getOptions()
    return new MatchRule(options.include, options.exclude).test(url)
  }

  isTagBlacklisted(node) {
    var blacklist = this.getOptions().blacklist
    var whitelist = this.getOptions().whitelist

    if (!Array.isArray(blacklist)) {
      blacklist = []
    }

    if (!Array.isArray(whitelist)) {
      whitelist = []
    }

    blacklist.push('style', 'script')

    blacklist = blacklist.filter(x => !whitelist.includes(x))

    switch (node.nodeType) {
      // TEXT_NODE
      case 3:
        return typeof node.parentNode !== 'undefined' && node.parentNode !== null && blacklist.map(tag => tag.toLowerCase()).includes(node.parentNode.nodeName.toLowerCase())
      // ELEMENT_NODE
      case 1:
        return blacklist.map(tag => tag.toLowerCase()).includes(node.nodeName.toLowerCase())
    }

    return false
  }

  apply(node, key = 'value', groupName = '*') {
    if (this.isTagBlacklisted(node)) {
      return []
    }

    var undos = this._getConfiguration().reduce(function (carry, command) {
      if (!command.isApplicableForGroup(groupName)) {
        return carry
      }

      var undo = command.apply(node, key)

      if (undo === false) {
        return carry
      }

      if (Array.isArray(undo)) {
        return carry.concat(undo)
      }

      carry.push(undo)
      return carry
    }, [])
    return undos
  }

  getOptions() {
    if (this.options === false) {
      var filterOption = function (content, section) {
        return function (result, key) {
          // By default ini.parse sets "true" as the value
          if (key.charAt(0) === '@' && key.length > 1) {
            var value = content[key]

            if (typeof value === 'string') {
              value = [value]
            }

            if (content[key] !== true || key.substring(1) === 'template' || key.substring(1) === 'deprecated') {
              if (result.hasOwnProperty(key.substring(1))) {
                result[key.substring(1)] = result[key.substring(1)].concat(value)
              } else {
                result[key.substring(1)] = value
              }
              return result
            }
          }

          if (typeof content[key] === 'object' && content[key] !== null) {
            return Object.keys(content[key]).reduce(filterOption(content[key], key), result)
          }
          return result
        }
      }
      this.options = Object.keys(this.content).reduce(filterOption(this.content, ''), {})
    }
    return this.options
  }

  getImports() {
    var filterImport = function (content) {
      return function (result, key) {
        if (key.charAt(0) === '+') {
          result.push(key.substring(1))
        }

        if (typeof content[key] === 'object' && content[key] !== null) {
          return result.concat(Object.keys(content[key]).reduce(filterImport(content[key]), []))
        }

        return result
      }
    }
    return Object.keys(this.content).reduce(filterImport(this.content), [])
  }

  getVariables() {
    var repository = this.repository
    var filterVariable = function (content) {
      return function (result, key) {
        // By default ini.parse sets "true" as the value
        // $ is not a legal variable name
        if (key.charAt(0) === '$' && key.length > 1 && content[key] !== true) {
          var t = content[key].split('//')
          result.push(new Variable(key.substring(1), t[0], t[1] ? t[1] : ''))
          return result
        }

        if (typeof repository === 'object' && key.charAt(0) === '+') {
          return result.concat(repository.findByName(key.substring(1)).getVariables())
        }

        if (typeof content[key] === 'object' && content[key] !== null) {
          return result.concat(Object.keys(content[key]).reduce(filterVariable(content[key]), []))
        }

        return result
      }
    }

    var variables = Object.keys(this.content).reduce(filterVariable(this.content), [])

    // Variables are replaced longest first, to have a consistent behaviour for #35
    return variables.sort((a, b) => {
      return b.name.length - a.name.length
    }).map((variable) => {
      return variable.bind(this.values[variable.name])
    })
  }

  _getConfiguration() {
    if (this.patterns === false) {
      // get all variables upfront
      var variables = this.getVariables()
      var options = this.getOptions()
      var values = this.values
      var repository = this.repository

      var commandBuilder = new CommandBuilder(
        Array.isArray(options.namespace) ? options.namespace : [],
        Array.isArray(options.include) ? options.include : [],
        Array.isArray(options.exclude) ? options.exclude : []
      )

      var filterConfiguration = function (content) {
        return function (result, key) {
          // skip all variables
          // '$' is not a variable, so we also check for the length of the variable.
          // '@' is not an option, so we also check for the length of the option
          if ((key.charAt(0) === '$' && key.length > 1) || (key.charAt(0) === '@' && key.length > 1)) {
            return result
          }

          if (key.charAt(0) === '+') {
            var x = result.concat(repository.findByName(key.substring(1)).updateValues(values)._getConfiguration())
            return x
          }

          // skip for non-commands
          if (key.charAt(0) !== '!' && content[key] === true) {
            return result
          }

          if (typeof content[key] === 'object' && content[key] !== null) {
            return result.concat(Object.keys(content[key]).reduce(filterConfiguration(content[key]), []))
          }
          var value = variables.reduce((value, variable) => {
            return variable.apply(value)
          }, content[key])

          result.push(commandBuilder.build(key, value))

          return result
        }
      }

      this.patterns = Object.keys(this.content).reduce(filterConfiguration(this.content), [])
    }

    return this.patterns
  }
}

export default Configuration
