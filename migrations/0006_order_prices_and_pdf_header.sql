-- Add a document-title snapshot for new orders. The existing shop snapshot
-- columns on quotations retain the rest of the configured PDF header.
ALTER TABLE settings ADD COLUMN pdf_document_title TEXT NOT NULL DEFAULT 'Purchase Order';
ALTER TABLE quotations ADD COLUMN pdf_document_title TEXT;

-- Establish the requested local PDF-header defaults. Existing order snapshots
-- remain unchanged and continue to render with their saved values.
UPDATE settings
SET shop_name = 'RSK Holdings',
    address = '118/22, Keyzer Streat,' || char(10) || 'Colombo 11',
    phone = '0778917678',
    pdf_document_title = 'Purchase Order'
WHERE id = 1;
