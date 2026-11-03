# Offline editable Word conversion

The default DOCX export uses PDFium to read PDF pages, with Docling's Heron layout recognition and accurate TableFormer model to reconstruct reading order, paragraphs and table cells. Zion PDF writes ordinary Word paragraphs and tables into the document body. It uses the PDF object inventory for font formatting, pictures and native drawing geometry. It does not put body text into floating text boxes, and does not silently replace failed pages with screenshots.

Flowing content uses the source paragraph indents, line spacing and page sections. Answer rules and artwork keep their page positions without adding separate blocks of vertical space. Cover layouts with text beside tables and background-heavy designs keep editable paragraphs positioned over their original artwork. Native paths become Word drawings where supported; complex artwork remains a picture of the artwork region. This is not a guarantee of Acrobat-equivalent conversion for every PDF. Scanned text should first use the application's existing offline OCR. The separate **Page images** export is explicitly non-editable.

PDF.js supplies Unicode text once; the native inventory supplies font faces, colours, mixed sizes and raised text. Filled border rectangles and merged ruled cells are reconstructed as native tables. Cell entries retain their separate lines, and existing PDF question labels are not replaced with automatic Word bullets.

## Build

Use Python 3.12 as a build tool, then run `npm run converter:build`. Set `ZIONPDF_BUILD_PYTHON` to its executable if necessary. The script creates a private environment, installs CPU inference libraries, downloads pinned model revisions, verifies the model weight checksums, and builds a standalone helper with PyInstaller. End users need neither Python nor Microsoft Office.

`conversion/runtime/<platform>-<architecture>/` contains the executable, dependencies, models, notices and a file manifest. Generated runtimes and the build environment are ignored by Git. The packaging hook rejects missing runtimes or damaged model files. A universal macOS installer includes separate Intel and Apple Silicon helpers and selects the matching one at runtime; the reusable build workflow prepares both. Other platforms use their native helper.

`npm run build`, `npm run smoke`, `npm run test:word-layout`, and `npm run test:save-export` check the application and export behavior. The Word export test covers wrapped paragraphs, native tables, merged cells, drawings, pictures, transparent/rotated/blank pages, page ranges, cancellation and unchanged PDF input. Inspect rendered outputs in `release/smoke/word-layout` as well as the document structure.

For the user-supplied nine-page Apollo exam regression, run `node scripts/test-word-exam.mjs <source.pdf>`. The private exam is not checked into the repository. On a Windows development machine with Word installed, `scripts/verify-word-exam.ps1` checks nine rendered pages, three native tables and actual paragraph/cell editing on a verification copy. Then run `node scripts/check-word-exam-render.mjs <source.pdf> release/smoke/word-exam/exam-word.pdf` to check that original phrases remain on their pages and beside their answer spaces. Inspect all rendered pages as well. Microsoft Word is a development verification tool only; the application converter still requires neither Office nor an online service.

## Runtime boundaries

The main process accepts PDF bytes from the trusted application page, creates a private temporary job directory, and starts the bundled executable without a shell or visible console. Passwords travel in a temporary request file, not command-line arguments. Progress is scoped to the requesting renderer. Canceling, closing the window, a renderer crash, or quitting terminates its tracked helper. The PDF is never overwritten by conversion; an export is saved only after reconstruction succeeds.

The helper explicitly disables remote services, external plugins, model downloads and socket connections. Only the selected pages are passed to document recognition. Temporary source, password and output files are removed after success, failure or cancellation. Failed conversions are surfaced to the user, without substituting a non-editable document.

## Licenses

Docling is MIT licensed; Heron weights are Apache-2.0 and TableFormer weights are CDLA-Permissive-2.0. Full notices accompany the frozen runtime, including native PDF and inference dependencies. Model revisions and SHA-256 values are recorded in `models/models.json`. No paid license or online conversion service is required.
