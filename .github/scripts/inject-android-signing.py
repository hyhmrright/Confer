#!/usr/bin/env python3
"""Inject a release signingConfig into the Tauri-generated Android build.gradle.kts.

`tauri android init` regenerates gen/android/app/build.gradle.kts on every CI run
without any release signing, so the APK ships unsigned unless we add a signingConfig
that reads gen/android/keystore.properties. This patch is idempotent and fails loudly
if the Tauri template structure changes — so we can never silently regress to an
unsigned (uninstallable) APK again.

Usage: inject-android-signing.py <path/to/app/build.gradle.kts>
"""

import re
import sys
from pathlib import Path

SIGNING_BLOCK = """    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            }
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
        }
    }

"""

RELEASE_SIGNING_LINE = '            signingConfig = signingConfigs.getByName("release")\n'


def fail(msg: str) -> None:
    print(f"::error::inject-android-signing: {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: inject-android-signing.py <path/to/build.gradle.kts>")

    path = Path(sys.argv[1])
    if not path.is_file():
        fail(f"{path} not found (did 'tauri android init' run first?)")

    src = path.read_text()
    if "keystore.properties" in src:
        print("release signingConfig already present; nothing to do")
        return

    # Ensure the imports the signing block relies on.
    for imp in ("import java.util.Properties", "import java.io.FileInputStream"):
        if imp not in src:
            first_import = re.search(r"^import .+$", src, re.M)
            if first_import:
                at = first_import.start()
                src = f"{src[:at]}{imp}\n{src[at:]}"
            else:
                src = f"{imp}\n{src}"

    # Insert the signingConfigs block right before `buildTypes {` (inside android {}).
    build_types = re.search(r"^[ \t]*buildTypes[ \t]*\{", src, re.M)
    if not build_types:
        fail("could not find a `buildTypes {` block — Tauri template changed?")
    at = build_types.start()
    src = f"{src[:at]}{SIGNING_BLOCK}{src[at:]}"

    # Make the release buildType use the release signingConfig.
    release = re.search(r'^[ \t]*getByName\("release"\)[ \t]*\{[ \t]*\n', src, re.M)
    if not release:
        fail('could not find `getByName("release") {` — Tauri template changed?')
    at = release.end()
    src = f"{src[:at]}{RELEASE_SIGNING_LINE}{src[at:]}"

    path.write_text(src)
    print(f"injected release signingConfig into {path}")


if __name__ == "__main__":
    main()
