// Makes the Capacitor WebView fullscreen + landscape before cap sync / gradle build.
import fs from 'node:fs';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
const stylesPath = 'android/app/src/main/res/values/styles.xml';

if (!fs.existsSync(manifestPath)) {
  console.error('Android manifest not found. Run `cap add android` first.');
  process.exit(1);
}

let manifest = fs.readFileSync(manifestPath, 'utf8');
if (manifest.includes('android:screenOrientation=')) {
  manifest = manifest.replace(
    /android:screenOrientation="[^"]*"/,
    'android:screenOrientation="landscape"',
  );
} else {
  manifest = manifest.replace(
    /([\t ]*<activity\b[^>]*?)(>)/,
    '$1 android:screenOrientation="landscape"$2',
  );
}
manifest = manifest.replace(
  /android:theme="@style\/[^"]*"/,
  'android:theme="@style/AppTheme.Fullscreen"',
);
fs.writeFileSync(manifestPath, manifest);

if (fs.existsSync(stylesPath)) {
  let styles = fs.readFileSync(stylesPath, 'utf8');
  if (!styles.includes('AppTheme.Fullscreen')) {
    styles = styles.replace(
      '</resources>',
      '    <style name="AppTheme.Fullscreen" parent="AppTheme">\n' +
        '        <item name="android:windowFullscreen">true</item>\n' +
        '        <item name="android:windowNoTitle">true</item>\n' +
        '    </style>\n' +
        '</resources>',
    );
  }
  fs.writeFileSync(stylesPath, styles);
}

console.log('Android patch applied: fullscreen + landscape.');
