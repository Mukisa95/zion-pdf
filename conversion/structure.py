"""Offline layout/reading-order/table recognition. The desktop shell owns each job directory."""
import json
import logging
import os
import sys
import socket
from pathlib import Path

# Set these before importing inference libraries. Runtime never downloads models.
os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", DO_NOT_TRACK="1", TOKENIZERS_PARALLELISM="false")
logging.basicConfig(stream=sys.stderr, level=logging.WARNING)

def no_network(*args, **kwargs):
    raise OSError("The Zion PDF converter runs offline; network access is disabled.")

socket.create_connection = no_network
socket.socket.connect = no_network
socket.socket.connect_ex = no_network


def emit(progress, message):
    print(json.dumps({"progress": progress, "message": message}), flush=True)


def convert(directory, artifacts):
    emit(0.01, "Loading offline document recognition")
    from pypdf import PdfReader, PdfWriter
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode, AcceleratorOptions, AcceleratorDevice
    from docling_core.types.doc import TextItem, TableItem, PictureItem

    request = json.loads((directory / "request.json").read_text(encoding="utf-8"))
    source = PdfReader(directory / "input.pdf")
    if source.is_encrypted and not source.decrypt(request.get("password") or ""):
        raise ValueError("The PDF password is incorrect.")
    pages = request["pages"]
    if not pages or any(not isinstance(p, int) or p < 1 or p > len(source.pages) for p in pages):
        raise ValueError("Choose valid pages to export.")
    options = PdfPipelineOptions(artifacts_path=artifacts, enable_remote_services=False, allow_external_plugins=False)
    # Native text stays native. Scanned documents can first use Zion PDF's bundled OCR.
    options.do_ocr = False
    options.do_table_structure = True
    options.table_structure_options.mode = TableFormerMode.ACCURATE
    options.generate_page_images = False
    options.generate_picture_images = False
    options.accelerator_options = AcceleratorOptions(num_threads=4, device=AcceleratorDevice.CPU)
    converter = DocumentConverter(allowed_formats=[InputFormat.PDF], format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options, backend=PyPdfiumDocumentBackend)})
    result = {"engine": "Docling 2.145.0", "pages": []}
    for index, number in enumerate(pages):
        emit(0.05 + 0.9 * index / len(pages), f"Understanding page {number} ({index + 1} of {len(pages)})")
        original = source.pages[number - 1]
        content = original.get_contents()
        if content is None or not content.get_data().strip():
            width, height = float(original.cropbox.width), float(original.cropbox.height)
            if int(original.get('/Rotate', 0)) % 180:
                width, height = height, width
            result["pages"].append({"number": number, "width": width, "height": height, "blocks": []})
            continue
        writer = PdfWriter()
        writer.add_page(original)
        single = directory / "page.pdf"
        with single.open("wb") as stream:
            writer.write(stream)
        conversion = converter.convert(single, raises_on_error=True)
        document = conversion.document
        height = document.pages[1].size.height

        def bbox(value):
            if value is None:
                return None
            box = value.to_top_left_origin(page_height=height)
            return [box.l, box.t, box.r - box.l, box.b - box.t]

        blocks = []
        for item, level in document.iterate_items():
            if not getattr(item, "prov", None):
                continue
            box = bbox(item.prov[0].bbox)
            if isinstance(item, TableItem):
                data = item.data
                blocks.append({"kind": "table", "box": box, "rows": data.num_rows, "cols": data.num_cols, "cells": [
                    {"text": cell.text, "row": cell.start_row_offset_idx, "col": cell.start_col_offset_idx,
                     "rowSpan": cell.row_span, "colSpan": cell.col_span, "header": cell.column_header,
                     "box": bbox(cell.bbox)} for cell in data.table_cells]})
            elif isinstance(item, TextItem):
                blocks.append({"kind": "text", "box": box, "text": item.text, "label": item.label.value,
                               "level": getattr(item, "level", None), "marker": getattr(item, "marker", None)})
            elif isinstance(item, PictureItem):
                blocks.append({"kind": "picture", "box": box})
        result["pages"].append({"number": number, "width": document.pages[1].size.width, "height": height, "blocks": blocks})
    (directory / "structure.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    emit(1, "Document structure reconstructed")


if __name__ == "__main__":
    try:
        convert(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print("ZION_ERROR:" + str(error).replace("\n", " ")[:600], file=sys.stderr, flush=True)
        sys.exit(1)
