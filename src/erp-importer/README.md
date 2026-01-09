# ERP Auto-Importer

Automatically imports products and clients from ERP database into the application database.

## Features

- **Auto-scheduled**: Runs daily at 5 AM
- **Manual trigger**: POST `/erp-importer/import`
- **Multi-org support**: Configure via `EXTERNAL_IMPORTER` env var
- **Smart deduplication**: Updates existing records, creates new ones

## Configuration

Add to `.env`:

```env
# Comma-separated list of organization UIDs to import for
EXTERNAL_IMPORTER=[1,2,3]

# Enable/disable auto-import (default: false)
ERP_IMPORT_ENABLED=true
```

## Usage

### Automatic Import
Runs daily at 5 AM automatically when `ERP_IMPORT_ENABLED=true`

### Manual Import
```bash
POST /erp-importer/import
```

Returns:
```json
{
  "products": {
    "created": 150,
    "updated": 25,
    "skipped": 5,
    "errors": []
  },
  "clients": {
    "created": 200,
    "updated": 30,
    "skipped": 10,
    "errors": []
  },
  "timestamp": "2024-01-15T05:00:00.000Z"
}
```

## Data Mapping

### Products (from `tblsaleslines`)
- `item_code` → `productReferenceCode`
- `description` → `name`
- `category` → `category`
- `incl_price` (avg) → `price` & `salePrice`
- `unit` → `packageUnit`
- Auto-generates `sku` and `productRef`

### Clients (from `tblcustomers`)
- `Code` → lookup key
- `Description`/`CustomerName` → `name`
- `Email` → `email` (validated)
- `Cellphone`/`Tel` → `phone`
- `Category` → `category`
- `Creditlimit` → `creditLimit`
- `balance` → `outstandingBalance`
- Physical addresses → `address` object

## Notes

- Products deduplicated by `productReferenceCode` per organization
- Clients deduplicated by `email` or `phone` per organization
- Missing data fields left as `null` (no dummy data generated)
- Only imports inventory items (`type = 'I'`)
- Skips clients without email AND phone
