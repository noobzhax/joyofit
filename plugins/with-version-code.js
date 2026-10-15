// versionCode = minutes since 2024-01-01 UTC, the scheme JoyoRogo uses: it rises with every build, needs no manual bump
// and stays below Play's 2100000000 cap for thousands of years. JOYOFIT_VERSION_CODE (or -PjoyofitVersionCode) pins it,
// which scripts/build-release.sh does so the file name and the build agree.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// joyofit-version-code';

const DEFINITION = `${MARKER}
def joyofitVersionCode = (findProperty('joyofitVersionCode') ?: System.getenv('JOYOFIT_VERSION_CODE') ?: ((System.currentTimeMillis().intdiv(1000L) - 1704067200L).intdiv(60L)).toString()).toInteger()
`;

function applyVersionCode(gradle) {
  if (gradle.includes(MARKER)) return gradle;
  let out = gradle.replace(/^android \{/m, `${DEFINITION}\nandroid {`);
  out = out.replace(/^(\s*)versionCode \d+/m, '$1versionCode joyofitVersionCode');
  if (!out.includes('versionCode joyofitVersionCode')) {
    throw new Error('with-version-code: app/build.gradle layout changed; versionCode not applied');
  }
  return out;
}

module.exports = function withVersionCode(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyVersionCode(cfg.modResults.contents);
    return cfg;
  });
};
