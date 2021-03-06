class Settings {
  constructor(settings) {
    this.baseTemplate = typeof settings.baseTemplate === 'string' ? settings.baseTemplate : ''
    this.optionalFeatures = typeof settings.optionalFeatures === 'object' ? settings.optionalFeatures : {}
    this.connectors = typeof settings.connectors === 'object' ? settings.connectors : {}
    this.monkeyInterval = typeof settings.monkeyInterval === 'number' ? settings.monkeyInterval : parseInt(settings.monkeyInterval)
    this.debugMode = typeof settings.debugMode === 'boolean' ? settings.debugMode : false
  }

  isFeatureEnabled(featureName) {
    return typeof this.optionalFeatures[featureName] !== 'undefined' && this.optionalFeatures[featureName] === true
  }

  isDebugEnabled() {
    return this.debugMode
  }
}

export default Settings
