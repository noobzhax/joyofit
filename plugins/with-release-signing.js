// Signs release builds with keystore/keystore.properties when that file exists (it is gitignored).
// Without it, release builds keep Expo's default debug signing so CI and fresh clones still build.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// joyofit-release-signing';

const LOAD_PROPERTIES = `${MARKER}
def joyofitKeystoreProperties = new Properties()
def joyofitKeystoreFile = rootProject.file("../keystore/keystore.properties")
if (joyofitKeystoreFile.exists()) {
    joyofitKeystoreFile.withInputStream { joyofitKeystoreProperties.load(it) }
}
`;

const RELEASE_CONFIG = `
        release {
            if (joyofitKeystoreFile.exists()) {
                storeFile file(joyofitKeystoreProperties['storeFile'])
                storePassword joyofitKeystoreProperties['storePassword']
                keyAlias joyofitKeystoreProperties['keyAlias']
                keyPassword joyofitKeystoreProperties['keyPassword']
            }
        }`;

function applySigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;

  let out = gradle.replace(/^android \{/m, `${LOAD_PROPERTIES}\nandroid {`);

  // Add a release signing config next to Expo's debug one.
  out = out.replace(/signingConfigs \{(\s*)debug \{/, (match, ws) => `signingConfigs {${RELEASE_CONFIG}${ws}debug {`);

  // Point the release build type at it when the keystore is present.
  out = out.replace(
    /(release \{[^}]*?)signingConfig signingConfigs\.debug/,
    '$1signingConfig joyofitKeystoreFile.exists() ? signingConfigs.release : signingConfigs.debug',
  );

  if (!out.includes('signingConfigs.release')) {
    throw new Error('with-release-signing: app/build.gradle layout changed; release signing not applied');
  }
  return out;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applySigning(cfg.modResults.contents);
    return cfg;
  });
};
