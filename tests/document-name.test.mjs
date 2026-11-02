import test from 'node:test';
import assert from 'node:assert/strict';
import {documentPdfFilename} from '../supabase/functions/_shared/document-name.ts';
test('completed PDF filenames retain the original document title and avoid duplicate extensions',()=>{
 assert.equal(documentPdfFilename('租车合同 - Yitong Ma'),'租车合同 - Yitong Ma.pdf');
 assert.equal(documentPdfFilename('租车合同 - Yitong Ma.pdf'),'租车合同 - Yitong Ma.pdf');
 assert.equal(documentPdfFilename('Agreement.PDF'),'Agreement.PDF');
 assert.equal(documentPdfFilename('Lease\r\n/2026'),'Lease---2026.pdf');
});
