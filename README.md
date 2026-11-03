# Zion PDF

Zion PDF is a desktop PDF reader and editor for Windows, macOS, and Linux. It supports direct PDF editing, annotations, signatures, OCR, PDF creation and merging, and export to Word and images.

## Download

- **Windows installer:** [Download Zion-PDF-Setup.exe](https://github.com/Mukisa95/zion-pdf/releases/latest/download/Zion-PDF-Setup.exe). Run this file to install the application; you do not need the source code or other release files.
- **Source code:** [Download the code ZIP](https://github.com/Mukisa95/zion-pdf/archive/refs/heads/main.zip), or choose **Code → Download ZIP** on GitHub.
- **Other platforms and previous versions:** see [Releases](https://github.com/Mukisa95/zion-pdf/releases). Each release also includes a **Source code (zip)** for that exact version.

The first release provides the Windows installer. macOS and Linux installers will follow when ready. This initial Windows build does not update itself; download a later installer to update. The installer includes the offline converter and OCR resources. The source ZIP is for developers; it is not an installer and does not contain the generated converter runtime.

## What you can do

- Read PDFs in tabs, search, highlight, draw, add notes and signatures, and return to recently opened documents.
- Edit supported PDF text and images on the page, change formatting with available device fonts, arrange pages, and save changes or a copy.
- Detect text in images or pages with the bundled English OCR. Scan quality and document layout affect recognition.
- Create PDFs from images and merge PDFs, preview and reorder files and pages before saving.
- Export to editable Word documents, images, text and HTML. Scanned pages need OCR before editable Word export. Complex layouts and artwork may not convert perfectly.
- Use optional Ask AI features with a supported account; the document content you submit for a question is sent to the chosen provider. Reading, editing, OCR, merging and the bundled Word converter work locally.

## Build from source

Install Node.js 22 or newer, npm, and Python 3.12. From the project folder:

```sh
npm ci
npm run build
npm run smoke
```

`npm run build` prepares the app; the offline Word converter is a separate, large build. To create it for the current platform and then build a local Windows installer:

```sh
npm run converter:build
npm run dist:win:local
```

The converter build downloads its pinned models and dependencies during development. End users of the installer do not need Python, Microsoft Office, or an online conversion service. See [conversion/README.md](conversion/README.md) for platform support, model licenses, and build details.

## Publishing

The source repository and release downloads are intended for `Mukisa95/zion-pdf`. The installer and generated build folders are excluded from Git. See [docs/PUBLISHING.md](docs/PUBLISHING.md) and [AGENTS.md](AGENTS.md) for release preparation and authorization.

## License

Zion PDF is distributed under the [MIT License](LICENSE). The original copyright notice remains in place. See [Third-party notices](THIRD_PARTY_NOTICES.md) and the converter documentation for included components and model licenses.
