/// Mix-in for greeters.
mixin Greeter {
  /// Greet with a prefix.
  String greet(String prefix) => '$prefix world';
}

/// Reverse-string extension.
extension StringX on String {
  /// Returns the string reversed.
  String get reversed => split('').reversed.join();
}
