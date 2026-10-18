# Venue emergency-access documents — SCRUM-98, Sprint 3

Venue Staff can create or edit a venue with two optional source documents:

- **Emergency procedure:** PDF, up to 2 MB.
- **Evacuation floor plan:** PDF, PNG or JPEG, up to 2 MB.

Each limit is 2,097,152 decoded bytes. Uploads are drafts until the venue is saved. Saved documents can be downloaded, replaced or removed. Existing emergency-access and restriction notes remain editable for brief clarifications; staff do not have to transcribe a document. The venue details drawer and Safety Officer review show downloads. Uploading a file does not certify its accuracy or approve an event.

The API verifies file extensions, decoded size, base64 encoding, safe filenames and file signatures. It derives MIME types and sizes from validated files instead of trusting the browser. Venue creation and editing retain their existing Venue Staff permissions and revision checks. Omitting documents from an older API update preserves saved files; setting an individual document to `null` removes it.

Documents follow the existing event-attachment approach: bounded base64 files and metadata in PostgreSQL JSONB. They follow the existing venue catalogue's read visibility. No extra upload-service credentials or storage bucket are required. Existing public venue detail responses include these venue documents, so upload venue information suitable for that visibility.

## Database setup

Run once against each intended database, using its existing `backend/.env` configuration:

```sh
npm run migrate:venue-emergency-documents --prefix backend
```

This applies only `backend/src/db/migrations/20261018021358_venue_emergency_information.sql`. It adds an optional JSONB document map, preserves existing notes and records, and can be rerun. It does not seed data or replay historical migrations. The shared venue table is not automatically upgraded by starting the application. The migration was verified on a session-local PostgreSQL table without altering application records.

## Tests

```sh
node tests/run.cjs story venue-emergency-access
npm test --prefix frontend
npm test --prefix frontend -- --coverage
npm run build --prefix frontend
npm test --prefix backend
```

The story command includes the venue form/profile, file validation, create/update API, migration and Safety Officer regressions. External HTTP/database boundaries are mocked in unit/API tests. The temporary PostgreSQL verification checks migration repeatability, legacy defaults, JSONB persistence and invalid document-map rejection. Test names, evidence and results are recorded in `docs/tests/test_specifications.csv` and `docs/tests/test_execution.csv`.

## Presentation references

Suntec separates emergency information from its evacuation guides and briefing material: [Emergency & Evacuation](https://www.evasuntec.com/en_US/safety-security/342389-4-51-emergency-evacuation-procedures). ICC Sydney supplies a dedicated procedure with an assembly-point map: [Emergency procedure](https://www.iccsydney.com.au/wp-content/uploads/2023/06/iccsydney-emergency-procedure.pdf). These informed the use of source documents plus optional notes; no venue-specific instructions have been copied into ConnectSphere.
