require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-better-clustering"
  # The Swift/Clang module keeps the Nitro module name (nitro.json iosModuleName):
  # the generated NitroMapCluster-Swift-Cxx-Umbrella.hpp and autolinking bridge
  # import it under that name.
  s.module_name  = "NitroMapCluster"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  # Release tags are `v`-prefixed (release-it tagName `v${version}`).
  s.source       = { :git => "https://github.com/gmi-software/react-native-better-clustering.git", :tag => "v#{s.version}" }

  # Listed explicitly rather than globbed, so tests, benchmarks or any other
  # file dropped into cpp/ can never be compiled into consumer apps (a glob
  # once shipped a bench with its own `int main()`). Keep in sync with
  # android/CMakeLists.txt.
  s.source_files = [
    "cpp/ClusterEngineCore.hpp",
    "cpp/GeoUtils.hpp",
    "cpp/HybridClusterEngine.hpp",
    "cpp/HybridClusterEngine.cpp",
  ]

  load 'nitrogen/generated/ios/NitroMapCluster+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
