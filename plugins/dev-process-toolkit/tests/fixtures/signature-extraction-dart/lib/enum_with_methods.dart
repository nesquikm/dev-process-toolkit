/// Traffic-light states.
enum Light {
  red,
  yellow,
  green;

  /// Whether this light means "stop".
  bool get isStop => this == Light.red;
}
