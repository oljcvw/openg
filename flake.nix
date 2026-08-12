{
  description = "Open Grind — declarative Android and iOS build toolchains";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      rust-overlay,
    }:
    flake-utils.lib.eachSystem
      [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ]
      (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ (import rust-overlay) ];
            config = {
              android_sdk.accept_license = true;
              allowUnfree = true;
            };
          };

          # Parsed from gradle.properties so versions live in exactly one place.
          gradleProperties =
            let
              raw = builtins.readFile ./src-tauri/gen/android/gradle.properties;
              lines = pkgs.lib.splitString "\n" raw;
              isPair = l: !(pkgs.lib.hasPrefix "#" l) && (builtins.match ".+=.+" l != null);
              toPair =
                l:
                let
                  i = builtins.stringLength (builtins.head (pkgs.lib.splitString "=" l));
                in
                {
                  name = builtins.substring 0 i l;
                  value = builtins.substring (i + 1) (builtins.stringLength l) l;
                };
            in
            builtins.listToAttrs (map toPair (builtins.filter isPair lines));

          androidPlatformVersion = gradleProperties."opengrind.android.compileSdk";
          androidBuildToolsVersion = gradleProperties."opengrind.android.buildTools";
          androidNdkVersion = gradleProperties."opengrind.android.ndk";
          androidCmakeVersion = gradleProperties."opengrind.android.cmake";

          rustToolchain = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;

          # Strip androidenv's 32-bit i686 deps (x86_64-linux only): realizing an
          # i686 drv calls personality(PER_LINUX32), which the arm64 kernel of
          # Docker Desktop's VM (Apple Silicon) rejects. Unused by APK builds.
          androidenv =
            if pkgs.stdenv.hostPlatform.system == "x86_64-linux" then
              import
                (pkgs.applyPatches {
                  name = "androidenv-no-i686";
                  src = "${nixpkgs}/pkgs/development/mobile/androidenv";
                  postPatch = ''
                    substituteInPlace build-tools.nix \
                      --replace-fail 'os == "linux" && stdenv.hostPlatform.isx86_64' 'false'
                    substituteInPlace build-tools.nix \
                      --replace-fail 'noAuditTmpdir = true;' \
                        'autoPatchelfIgnoreMissingDeps = [ "*" ]; noAuditTmpdir = true;'
                  '';
                })
                {
                  inherit (pkgs) lib;
                  pkgs = pkgs;
                }
            else
              pkgs.androidenv;

          androidComposition = androidenv.composeAndroidPackages {
            platformVersions = [ androidPlatformVersion ];
            buildToolsVersions = [ androidBuildToolsVersion ];
            ndkVersions = [ androidNdkVersion ];
            cmakeVersions = [ androidCmakeVersion ];
            includeNDK = true;
            includeEmulator = false;
            includeSources = false;
            includeSystemImages = false;
            includeExtras = [ ];
            toolsVersion = null; # deprecated, unused, and another i686 source
          };

          androidSdk = androidComposition.androidsdk;
          androidSdkRoot = "${androidSdk}/libexec/android-sdk";
          ndkRoot = "${androidSdkRoot}/ndk/${androidNdkVersion}";
          buildToolsBin = "${androidSdkRoot}/build-tools/${androidBuildToolsVersion}";
          cmakeBin = "${androidSdkRoot}/cmake/${androidCmakeVersion}/bin";

          jdk = pkgs.jdk21_headless;

          toolchainInputs = [
            rustToolchain
            pkgs.bun
            pkgs.nodejs_24
            jdk
            pkgs.gradle_8
            androidSdk
            pkgs.pkg-config
            pkgs.stdenv.cc
            pkgs.libclang.lib
            pkgs.gnused # gradlew's arg-parsing needs sed
            pkgs.git # boring-sys2 patches BoringSSL with `git apply` on every build
          ]
          ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
            pkgs.libiconv
          ];

          buildEnv = {
            JAVA_HOME = jdk.home;
            ANDROID_HOME = androidSdkRoot;
            ANDROID_SDK_ROOT = androidSdkRoot;
            ANDROID_NDK_HOME = ndkRoot;
            ANDROID_NDK_ROOT = ndkRoot;
            NDK_HOME = ndkRoot;
            LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
            CMAKE_GENERATOR = "Ninja";
          }
          // pkgs.lib.optionalAttrs pkgs.stdenv.isDarwin {
            LIBRARY_PATH = "${pkgs.libiconv}/lib";
          };

          envExports = pkgs.lib.concatStringsSep "\n" (
            pkgs.lib.mapAttrsToList (k: v: "export ${k}=${v}") buildEnv
          );

          buildAndroidScript = pkgs.writeShellApplication {
            name = "open-grind-build-android";
            runtimeInputs = toolchainInputs;
            text = ''
              set -euo pipefail

              ${envExports}
              export PATH="${buildToolsBin}:${cmakeBin}:$PATH"
              export NODE_OPTIONS="''${NODE_OPTIONS:---max-old-space-size=4096}"

              ROOT="''${OPEN_GRIND_ROOT:-$PWD}"
              cd "$ROOT"
              # rustc and clang see the symlink-resolved path, which is what must match.
              ROOT="$(pwd -P)"

              # F-Droid's buildserver fixes its checkout and HOME at /repo/build/<appid>
              # and /home/vagrant, so ours can never match; remap both sides to literals
              # instead. Lives here, not in build.yml, which F-Droid never reads.
              CARGO_HOME="''${CARGO_HOME:-$HOME/.cargo}"
              export CARGO_HOME
              export RUSTFLAGS="''${RUSTFLAGS:-} --remap-path-prefix=$CARGO_HOME=/cargo --remap-path-prefix=$ROOT=/open-grind"
              # rustc's remap misses C: BoringSSL bakes __FILE__ from boring-sys2's
              # OUT_DIR. cc forwards these into the cmake crate's CMAKE_C_FLAGS, and
              # neither var feeds cargo's unit hash, so boring-sys2-<hash> stays stable.
              prefixMaps="-ffile-prefix-map=$CARGO_HOME=/cargo -ffile-prefix-map=$ROOT=/open-grind"
              export CFLAGS="''${CFLAGS:-} $prefixMaps"
              export CXXFLAGS="''${CXXFLAGS:-} $prefixMaps"

              KEYSTORE_DEST="$ROOT/src-tauri/gen/android/keystore.properties"

              # Point AGP at the SDK's patchelf'd aapt2. Inject the machine-specific
              # /nix/store path through a dedicated Gradle user home rather than the
              # tracked gradle.properties: an EXIT trap is not crash-safe, and a leftover
              # store path must never reach git (it is wrong for every other machine). A
              # GRADLE_USER_HOME gradle.properties overrides the project one and accepts
              # the dotted key that -D/ORG_GRADLE_PROJECT_ env vars cannot express
              # (-D also does not reach the Gradle daemon, nixpkgs#402297). Docker caches
              # this dir via the open-grind-gradle volume (see docker-compose.yml).
              export GRADLE_USER_HOME="''${OPEN_GRIND_GRADLE_USER_HOME:-$HOME/.gradle-opengrind}"
              mkdir -p "$GRADLE_USER_HOME"
              {
                printf 'android.aapt2FromMavenOverride=%s/aapt2\n' "${buildToolsBin}"
                # AGP does not reliably invalidate a configuration-cache entry when
                # the ignored keystore.properties file appears or disappears. A stale
                # unsigned configuration silently emits an unsigned APK during a signed
                # build, so signed builds configure Gradle afresh.
                if [ -n "''${OPEN_GRIND_KEYSTORE_PROPERTIES:-}" ]; then
                  printf 'org.gradle.configuration-cache=false\n'
                fi
              } > "$GRADLE_USER_HOME/gradle.properties"

              # OPEN_GRIND_KEYSTORE_PROPERTIES -> keystore.properties for signingConfig.
              # keystore.properties is gitignored; remove it on exit so the secret does
              # not linger in the working tree.
              if [ -n "''${OPEN_GRIND_KEYSTORE_PROPERTIES:-}" ]; then
                cp "$OPEN_GRIND_KEYSTORE_PROPERTIES" "$KEYSTORE_DEST"
                trap 'rm -f "$KEYSTORE_DEST"' EXIT
              fi

              TARGET="''${1:-apk}"

              bun ci
              # OPEN_GRIND_ANDROID_ABI=aarch64 builds one ABI instead of universal.
              if [ -n "''${OPEN_GRIND_ANDROID_ABI:-}" ]; then
                bun run tauri android build --"$TARGET" --target "''${OPEN_GRIND_ANDROID_ABI}"
              else
                bun run tauri android build --"$TARGET"
              fi

              if [ -n "''${OPEN_GRIND_KEYSTORE_PROPERTIES:-}" ]; then sfx=""; else sfx="-unsigned"; fi
              base="$ROOT/src-tauri/gen/android/app/build/outputs"

              echo
              if [ "$TARGET" = "aab" ]; then
                echo "Produced app bundle(s) under: $base/bundle/"
              else
                # Version-stamp the APK post-build (not in Gradle, which would desync
                # Tauri's default-path lookup) so local/CI artifacts are identifiable.
                reldir="$base/apk/universal/release"
                src="$reldir/app-universal-release$sfx.apk"
                version="$(sed -n 's/^tauri\.android\.versionName=//p' \
                  "$ROOT/src-tauri/gen/android/app/tauri.properties")"
                apk="$reldir/open-grind-v$version$sfx.apk"
                if [ -f "$src" ]; then
                  mv -f "$src" "$apk"
                  printf 'Produced: %s (%s)\n' "$apk" "$(du -h "$apk" | cut -f1)"
                else
                  printf 'Produced: %s (expected, not found)\n' "$src"
                fi
              fi
            '';
          };

          iosToolchainInputs = [
            rustToolchain
            pkgs.bun
            pkgs.nodejs_24
            pkgs.git
          ]
          ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
            pkgs.cocoapods
            pkgs.libimobiledevice
            pkgs.xcodegen
          ];

          buildIosScript = pkgs.writeShellApplication {
            name = "open-grind-build-ios";
            runtimeInputs = iosToolchainInputs;
            text = ''
              set -euo pipefail

              if [ "$(uname -s)" != "Darwin" ]; then
                echo "The iOS build requires macOS and a host-installed Xcode." >&2
                exit 1
              fi

              developer_dir="$(xcode-select -p)"
              if [ ! -x "$developer_dir/usr/bin/xcodebuild" ]; then
                echo "xcode-select does not point to a complete Xcode developer directory: $developer_dir" >&2
                exit 1
              fi
              if ! xcrun --sdk iphoneos --show-sdk-path >/dev/null; then
                echo "The selected Xcode does not provide an iPhoneOS SDK." >&2
                exit 1
              fi

              root="''${OPEN_GRIND_ROOT:-$PWD}"
              cd "$root"
              if [ ! -f src-tauri/gen/apple/project.yml ]; then
                echo "Missing generated Apple project; run 'bun run tauri ios init --ci --skip-targets-install'." >&2
                exit 1
              fi
              submodule_status="$(git submodule status --recursive)"
              if [ -z "$submodule_status" ] || printf '%s\n' "$submodule_status" | grep -Eq '^[-+U]'; then
                echo "Git submodules are not initialized at their pinned revisions." >&2
                exit 1
              fi

              if [ "$#" -eq 0 ]; then
                set -- --debug --target aarch64-sim --no-sign
                # Tauri 2.11's iOS bundler does not replace its previous app
                # bundle and otherwise fails with "Directory not empty" on a
                # second identical build. This is a generated, target-exact
                # artifact; remove no other Apple build products.
                rm -rf "$root/src-tauri/gen/apple/build/arm64-sim/Open Grind.app"
              fi

              bash scripts/check-ios-build-authority.sh "$@"

              signed_build=1
              for argument in "$@"; do
                if [ "$argument" = "--no-sign" ]; then
                  signed_build=0
                  break
                fi
              done
              if [ "$signed_build" -eq 1 ]; then
                # xcodebuild consumes DEVELOPMENT_TEAM as a build setting.
                # Keep APPLE_DEVELOPMENT_TEAM as the explicit authority input,
                # then bridge it only for signed builds after the guard passes.
                export DEVELOPMENT_TEAM="$APPLE_DEVELOPMENT_TEAM"
              fi

              export NODE_OPTIONS="''${NODE_OPTIONS:---max-old-space-size=4096}"
              bun ci

              echo "Building iOS with Xcode at: $developer_dir"
              bun run tauri ios build "$@"
            '';
          };

          testIosScript = pkgs.writeShellApplication {
            name = "open-grind-test-ios";
            runtimeInputs = iosToolchainInputs;
            text = ''
              set -euo pipefail

              if [ "$(uname -s)" != "Darwin" ]; then
                echo "The iOS tests require macOS and a host-installed Xcode." >&2
                exit 1
              fi
              if [ "$#" -ne 1 ] || [ -z "$1" ]; then
                echo "Usage: nix run .#test-ios -- <simulator-udid>" >&2
                exit 2
              fi

              developer_dir="$(xcode-select -p)"
              if [ ! -x "$developer_dir/usr/bin/xcodebuild" ]; then
                echo "xcode-select does not point to a complete Xcode developer directory: $developer_dir" >&2
                exit 1
              fi

              root="''${OPEN_GRIND_ROOT:-$PWD}"
              project="$root/src-tauri/gen/apple/open-grind.xcodeproj"
              if [ ! -d "$project" ]; then
                echo "Missing generated Apple project: $project" >&2
                exit 1
              fi

              # Nix compiler-wrapper variables corrupt host Xcode's XCTest
              # linker arguments. Keep Nix-provided command dependencies, but
              # let Xcode own its compiler and SDK environment end to end.
              while IFS='=' read -r name _; do
                case "$name" in
                  NIX_* | LD_FOR_BUILD | LD_DYLD_PATH) unset "$name" ;;
                esac
              done < <(env)

              exec xcodebuild test \
                -project "$project" \
                -scheme open-grind_iOSTests \
                -destination "platform=iOS Simulator,id=$1" \
                CODE_SIGNING_ALLOWED=NO
            '';
          };
        in
        {
          devShells.default = pkgs.mkShell (
            buildEnv
            // {
              packages = toolchainInputs ++ [
                pkgs.minisign
                pkgs.shellcheck
              ];
              shellHook = ''
                # androidenv exposes only adb/sdkmanager; add build-tools + cmake.
                export PATH="${buildToolsBin}:${cmakeBin}:$PATH"

                echo "Open Grind dev shell: Android toolchain pinned via Nix."
                echo "  Rust:      $(rustc --version)"
                echo "  JDK:       $JAVA_HOME"
                echo "  SDK:       $ANDROID_HOME"
                echo "  NDK:       $NDK_HOME"
              '';
            }
          );

          packages = {
            default = buildAndroidScript;
            build-android = buildAndroidScript;
          }
          // pkgs.lib.optionalAttrs pkgs.stdenv.isDarwin {
            build-ios = buildIosScript;
            test-ios = testIosScript;
          };

          apps = {
            default = {
              type = "app";
              program = "${buildAndroidScript}/bin/open-grind-build-android";
            };
            build-android = {
              type = "app";
              program = "${buildAndroidScript}/bin/open-grind-build-android";
            };
          }
          // pkgs.lib.optionalAttrs pkgs.stdenv.isDarwin {
            build-ios = {
              type = "app";
              program = "${buildIosScript}/bin/open-grind-build-ios";
            };
            test-ios = {
              type = "app";
              program = "${testIosScript}/bin/open-grind-test-ios";
            };
          };

          formatter = pkgs.nixfmt-rfc-style;
        }
      );
}
