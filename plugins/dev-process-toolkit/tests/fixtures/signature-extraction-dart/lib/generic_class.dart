/// A typed container.
class Container<T extends Object> {
  /// The held value.
  final T value;

  /// Construct with [value].
  Container(this.value);

  /// Whether the value equals [other].
  bool sameAs(T other) => value == other;
}
