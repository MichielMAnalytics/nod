import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/attachments.dart';

class AttachmentTile extends StatelessWidget {
  const AttachmentTile({
    required this.artifact,
    required this.repository,
    super.key,
    this.compact = false,
  });
  final bool compact;
  final NodArtifact artifact;
  final NodAttachmentsRepository repository;

  @override
  Widget build(BuildContext context) {
    if (compact) {
      return IconButton(
        tooltip: 'Preview ${artifact.name}',
        icon: const Icon(Icons.visibility_outlined),
        onPressed: () => showDialog<void>(
          context: context,
          builder: (_) =>
              _AttachmentPreview(artifact: artifact, repository: repository),
        ),
      );
    }
    return OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        foregroundColor: Theme.of(context).colorScheme.onSurface,
      ),
      onPressed: () => showDialog<void>(
        context: context,
        builder: (_) =>
            _AttachmentPreview(artifact: artifact, repository: repository),
      ),
      icon: Icon(
        artifact.mimeType.startsWith('image/')
            ? Icons.image_outlined
            : Icons.insert_drive_file_outlined,
      ),
      label: Text(
        '${artifact.name} · ${formatAttachmentSize(artifact.size)}',
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
    );
  }
}

String formatAttachmentSize(int bytes) => bytes < 1024 * 1024
    ? '${(bytes / 1024).ceil()} KB'
    : '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';

class _AttachmentPreview extends StatefulWidget {
  const _AttachmentPreview({required this.artifact, required this.repository});
  final NodArtifact artifact;
  final NodAttachmentsRepository repository;
  @override
  State<_AttachmentPreview> createState() => _AttachmentPreviewState();
}

class _AttachmentPreviewState extends State<_AttachmentPreview> {
  final _cancelled = Completer<void>();
  Directory? _directory;
  File? _file;
  String? _error;
  bool _sharing = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final temp = await getTemporaryDirectory();
      final directory = await Directory(temp.path).createTemp('nod-preview-');
      _directory = directory;
      final name = widget.artifact.name.replaceAll(
        RegExp(r'[^a-zA-Z0-9._ -]'),
        '_',
      );
      final file = File(
        '${directory.path}/${name.isEmpty || name == '.' || name == '..' ? 'attachment' : name.substring(0, name.length.clamp(0, 160))}',
      );
      await widget.repository.downloadAttachment(
        widget.artifact,
        file,
        cancelled: _cancelled.future,
      );
      if (mounted) setState(() => _file = file);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Could not download this file. It may be unavailable, or Nod may be offline.',
        );
      }
    } finally {
      if (!mounted) await _cleanup();
    }
  }

  Future<void> _cleanup() async {
    try {
      if (_directory != null && await _directory!.exists()) {
        await _directory!.delete(recursive: true);
      }
    } catch (_) {}
  }

  Future<void> _share() async {
    if (_sharing || _file == null) return;
    setState(() => _sharing = true);
    try {
      final box = context.findRenderObject()! as RenderBox;
      await SharePlus.instance.share(
        ShareParams(
          files: [XFile(_file!.path, mimeType: widget.artifact.mimeType)],
          sharePositionOrigin: box.localToGlobal(Offset.zero) & box.size,
        ),
      );
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Could not open the share sheet. Please try again.',
        );
      }
    } finally {
      if (mounted) {
        setState(() => _sharing = false);
      } else {
        await _cleanup();
      }
    }
  }

  @override
  void dispose() {
    _cancelled.complete();
    if (!_sharing) unawaited(_cleanup());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final image = const {
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'image/heic',
    }.contains(widget.artifact.mimeType);
    return AlertDialog(
      title: Text(
        widget.artifact.name,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      content: SizedBox(
        width: 480,
        child: _error != null
            ? Text(_error!)
            : _file == null
            ? const Padding(
                padding: EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 16),
                    Text('Downloading file…'),
                  ],
                ),
              )
            : image
            ? ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.sizeOf(context).height * 0.5,
                ),
                child: InteractiveViewer(
                  child: Image.file(
                    _file!,
                    cacheWidth: 1600,
                    cacheHeight: 1600,
                    errorBuilder: (_, error, stack) => const Text(
                      'Image preview unavailable. Use Open or save to view this file.',
                    ),
                  ),
                ),
              )
            : Text(
                '${formatAttachmentSize(widget.artifact.size)} · ${widget.artifact.mimeType}\n\nOpen or save this file using an app on your device. Active content is not executed inside Nod.',
              ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Close'),
        ),
        if (_file != null)
          FilledButton(
            onPressed: _sharing ? null : _share,
            child: const Text('Open or save'),
          ),
      ],
    );
  }
}
