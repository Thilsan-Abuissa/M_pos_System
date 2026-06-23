import re, sys

with open('renderer/app.js', 'r') as f:
    content = f.read()

start = content.index('  // Drag & drop\n  const dropzone')
end = content.index('\nfunction closeBulkUploadOverlay')

new_block = (
    "  // Drag & drop — CSV dropzone\n"
    "  const dropzone = document.getElementById('bulkUploadDropzone');\n"
    "  if (dropzone && !dropzone.dataset.dndAttached) {\n"
    "    dropzone.dataset.dndAttached = '1';\n"
    "    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = '#2563eb'; dropzone.style.background = '#eff6ff'; });\n"
    "    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = '#93c5fd'; dropzone.style.background = '#f8faff'; });\n"
    "    dropzone.addEventListener('drop', (e) => {\n"
    "      e.preventDefault();\n"
    "      dropzone.style.borderColor = '#93c5fd';\n"
    "      dropzone.style.background = '#f8faff';\n"
    "      const file = e.dataTransfer?.files?.[0];\n"
    "      if (file) handleBulkUploadFile(file);\n"
    "    });\n"
    "  }\n"
    "  // Drag & drop — Image dropzone\n"
    "  const imgDz = document.getElementById('imgDropzone');\n"
    "  if (imgDz && !imgDz.dataset.dndAttached) {\n"
    "    imgDz.dataset.dndAttached = '1';\n"
    "    imgDz.addEventListener('dragover', (e) => { e.preventDefault(); imgDz.style.background = '#ede9fe'; });\n"
    "    imgDz.addEventListener('dragleave', () => { imgDz.style.background = '#faf5ff'; });\n"
    "    imgDz.addEventListener('drop', (e) => {\n"
    "      e.preventDefault(); imgDz.style.background = '#faf5ff';\n"
    "      const dropped = e.dataTransfer.files;\n"
    "      if (dropped && dropped.length) handleBulkImageFiles(dropped);\n"
    "    });\n"
    "  }\n"
    "}"
)

content = content[:start] + new_block + content[end:]

with open('renderer/app.js', 'w') as f:
    f.write(content)

print('Done')
