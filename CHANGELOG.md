# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [6.1.2] - 2026-05-05

### Added

- **Whisper 本地模型测试连接**：新增「测试连接」按钮，快速验证 Whisper CLI、模型文件、VAD 模型是否就绪
- **存储目录结构说明**：在存储设置页面新增外部/内部存储目录结构说明，帮助用户理解各文件夹用途

### Changed

- **GitHub 仓库链接迁移**：代码中所有 GitHub 链接从 `solidSpoon` 迁移至 `huwanidea`
- **WiX maker 配置**：禁用 WiX maker，修复发布配置

### Fixed

- **Whisper API 类型缺失**：修复 `test-whisper` API 在 `api-def.ts` 中缺失导致的 "No handle" 错误
- **VAD 模型路径不一致**：统一 `testWhisper()` 与 `WhisperCppArgsBuilder` 的 VAD 模型路径检测逻辑
- **翻译/Whisper 路径处理**：修复路径解析问题，提升稳定性

### Changed

- Refactored logging to remove tag-based filtering and APIs.
- Standardized debug filtering on log level + module include/exclude + focus token.
- Added `withFocus()` support for main/renderer loggers and `[FOCUS:<token>]` compatibility.
- Updated renderer-to-main log event payload to use `focus` (removed `tags`).
- Added `log-focus-debug` skill for AI-assisted temporary log focus workflow.
- Added `src/vite-env.d.ts` to fix `import.meta.env` TypeScript typing.

