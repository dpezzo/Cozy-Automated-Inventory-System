# Synthetic bake-off fixture bundle

Run date: **2026-09-18** in **America/New_York**. Rule: **olliix-inventory-v1**, threshold **6**.

This bundle is shared benchmark truth for Replit, Codex, and Claude. Do not regenerate expected files from a competing implementation.

## Inputs

- `Olliix_synthetic_inventory.xlsx`: two-row Olliix header structure and 24 vendor rows.
- `Miva_synthetic_pre_import.csv`: 22-product pre-run snapshot.
- `Olliix_Audit_Master_synthetic_legacy.csv`: legacy comparison input. It deliberately contains one approved deviation (SYN-022) and one unexplained error (SYN-001).
- `Miva_synthetic_post_import.csv`: simulated post-import snapshot. It deliberately contains an unapproved change (SYN-027/P002) and a failed blank clear (SYN-028/P020).

## Expected outputs

- `expected_reconciliation.csv`: authoritative row-level result and demo decisions.
- `expected_update.csv` and `expected_rollback.csv`: paired immutable batch.
- `expected_exceptions.csv`: warning and blocked rows.
- `expected_legacy_comparison.csv`: expected validator classifications.
- `expected_post_import_verification.csv`: expected verification pass/fail results.
- `fixture_cases.csv`: coverage map for all 28 cases.

## Demo decisions

The authoritative decision states are in `expected_reconciliation.csv`. The expected batch approves P001, P004, P012 (warning acknowledged), P013, P015, P018, P019, and P020. P002 is rejected; P003 and remaining warning rows stay pending.

## Pass rules

A build must reproduce the expected reconciliation and generated files exactly after applying the documented deterministic ordering. Legacy comparison must report SYN-022 as DEV-001, SYN-001 as unexplained, and unsafe rows as not comparable. Post-import verification must fail for P002 and P020 for the documented reasons.
