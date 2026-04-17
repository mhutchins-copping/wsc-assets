# Scan Feature QA Checklist

Use this checklist to test the AI label scanning feature on real devices. Fill in each row with what you observe.

## Testing Instructions

1. Open WSC Assets at https://assets.it-wsc.com
2. Go to Assets → "+ New Asset"
3. Click "📷 Scan from photo"
4. Take a clear photo of the device's label/sticker
5. Fill in the results below

## Results Table

| # | Device Type | Serial Readable? | Sticker Condition | Confidence | Manufacturer | Model | Serial | MAC | Category | All Fields Correct? | Notes |
|---|-------------|------------------|-------------------|------------|--------------|-------|--------|-----|----------|---------------------|-------|
| 1 |             |                  |                   |            |              |       |        |     |          |                     |       |
| 2 |             |                  |                   |            |              |       |        |     |          |                     |       |
| 3 |             |                  |                   |            |              |       |        |     |          |                     |       |
| 4 |             |                  |                   |            |              |       |        |     |          |                     |       |
| 5 |             |                  |                   |            |              |       |        |     |          |                     |       |
| 6 |             |                  |                   |            |              |       |        |     |          |                     |       |
| 7 |             |                  |                   |            |              |       |        |     |          |                     |       |
| 8 |             |                  |                   |            |              |       |        |     |          |                     |       |
| 9 |             |                  |                   |            |              |       |        |     |          |                     |       |
| 10|             |                  |                   |            |              |       |        |     |          |                     |       |

## Sticker Condition Key

- **Perfect**: Clear, flat, well-lit label
- **Good**: Slightly worn but legible
- **Poor**: Faded, curved, or partially obscured
- **Damaged**: Water damage, missing sections

## Decision Prompt

Count entries where "All Fields Correct?" = Yes and confidence = high:

- **7+ entries show high confidence with all-fields-correct** → Stay on Haiku model
- **5+ entries show medium or low confidence** → Consider upgrading to Sonnet model

## Confidence Level Reference

According to the system prompt, confidence levels mean:

| Level | What it means |
|-------|---------------|
| **high** | All fields read clearly and confidently. Serial number unambiguous. |
| **medium** | Some ambiguity in serial number (similar characters like 0/O, 1/I, 5/S, 8/B). Partial label visible. |
| **low** | Multiple fields unreadable, label partially obscured, or significant uncertainty in reading. |

## Test Device Ideas

- Dell laptops (Service Tag sticker on bottom)
- HP laptops (Serial label on chassis)
- Monitors (serial tag usually on back)
- Printers (serial often near power port)
- Switches/routers (label on bottom or back)
