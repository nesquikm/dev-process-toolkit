// STE-103 Dart signature extractor: walks lib/**/*.dart with package:analyzer
// and emits a JSON ModuleSignatures[] payload to stdout for the TypeScript
// wrapper in adapters/_shared/src/signature_extractor.ts to consume.
import 'dart:convert';
import 'dart:io';

import 'package:analyzer/dart/analysis/analysis_context_collection.dart';
import 'package:analyzer/dart/analysis/results.dart';
import 'package:analyzer/dart/ast/ast.dart';

Future<void> main(List<String> args) async {
  if (args.isEmpty) {
    stderr.writeln('usage: extract_signatures <projectRoot>');
    exitCode = 2;
    return;
  }
  final projectRoot = args[0];
  final libDir = Directory('$projectRoot/lib');
  if (!libDir.existsSync()) {
    stdout.write(jsonEncode(<dynamic>[]));
    return;
  }

  final collection = AnalysisContextCollection(
    includedPaths: [libDir.absolute.path],
  );

  final modules = <Map<String, dynamic>>[];

  for (final ctx in collection.contexts) {
    final files = ctx.contextRoot
        .analyzedFiles()
        .where((p) => p.endsWith('.dart'))
        .toList()
      ..sort();
    for (final path in files) {
      final result = await ctx.currentSession.getResolvedUnit(path);
      if (result is! ResolvedUnitResult) continue;
      final exports = _collectExports(result, projectRoot, path);
      final relPath = _toPosixRelative(projectRoot, path);
      modules.add({'modulePath': relPath, 'exports': exports});
    }
  }

  modules.sort((a, b) =>
      (a['modulePath'] as String).compareTo(b['modulePath'] as String));
  stdout.write(jsonEncode(modules));
}

List<Map<String, dynamic>> _collectExports(
  ResolvedUnitResult result,
  String projectRoot,
  String absPath,
) {
  final exports = <Map<String, dynamic>>[];
  final source = result.content;
  final lineInfo = result.lineInfo;
  final relPath = _toPosixRelative(projectRoot, absPath);

  for (final member in result.unit.declarations) {
    final names = _namesFor(member);
    if (names.isEmpty) continue;
    final kind = _kindFor(member);
    if (kind == null) continue;

    final ann = member as AnnotatedNode;
    final sigOffset = ann.firstTokenAfterCommentAndMetadata.offset;
    final sigEnd = member.end;
    if (sigOffset >= sigEnd) continue;
    final signature = source.substring(sigOffset, sigEnd);
    final doc = _docComment(ann);
    final startLoc = lineInfo.getLocation(sigOffset);
    final endLoc = lineInfo.getLocation(sigEnd);

    for (final name in names) {
      if (name.startsWith('_')) continue;
      final entry = <String, dynamic>{
        'name': name,
        'kind': kind,
        'signature': signature,
        'sourceFile': relPath,
        'sourceLineStart': startLoc.lineNumber,
        'sourceLineEnd': endLoc.lineNumber,
      };
      if (doc != null) entry['docComment'] = doc;
      exports.add(entry);
    }
  }
  exports.sort((a, b) =>
      (a['name'] as String).compareTo(b['name'] as String));
  return exports;
}

List<String> _namesFor(CompilationUnitMember member) {
  if (member is FunctionDeclaration) return [member.name.lexeme];
  if (member is ClassDeclaration) return [member.name.lexeme];
  if (member is MixinDeclaration) return [member.name.lexeme];
  if (member is EnumDeclaration) return [member.name.lexeme];
  if (member is GenericTypeAlias) return [member.name.lexeme];
  if (member is FunctionTypeAlias) return [member.name.lexeme];
  if (member is ExtensionDeclaration) {
    final n = member.name?.lexeme;
    return n == null ? const <String>[] : [n];
  }
  if (member is TopLevelVariableDeclaration) {
    return member.variables.variables.map((v) => v.name.lexeme).toList();
  }
  return const <String>[];
}

String? _kindFor(CompilationUnitMember member) {
  if (member is FunctionDeclaration) return 'function';
  if (member is ClassDeclaration) return 'class';
  if (member is MixinDeclaration) return 'class';
  if (member is ExtensionDeclaration) return 'class';
  if (member is EnumDeclaration) return 'enum';
  if (member is GenericTypeAlias) return 'type';
  if (member is FunctionTypeAlias) return 'type';
  if (member is TopLevelVariableDeclaration) return 'const';
  return null;
}

String? _docComment(AnnotatedNode node) {
  final dc = node.documentationComment;
  if (dc == null) return null;
  final lines = <String>[];
  for (final tok in dc.tokens) {
    var s = tok.lexeme;
    if (s.startsWith('///')) {
      s = s.substring(3);
      if (s.startsWith(' ')) s = s.substring(1);
      lines.add(s);
    } else if (s.startsWith('/**') && s.endsWith('*/')) {
      final body = s.substring(3, s.length - 2);
      final inner = body
          .split('\n')
          .map((l) {
            var t = l.trim();
            if (t.startsWith('*')) t = t.substring(1).trim();
            return t;
          })
          .where((l) => l.isNotEmpty)
          .join('\n');
      lines.add(inner);
    } else {
      lines.add(s);
    }
  }
  final result = lines.join('\n').trim();
  return result.isEmpty ? null : result;
}

String _toPosixRelative(String root, String abs) {
  var rel = abs;
  if (rel.startsWith(root)) {
    rel = rel.substring(root.length);
    if (rel.startsWith('/') || rel.startsWith('\\')) rel = rel.substring(1);
  }
  return rel.replaceAll('\\', '/');
}
