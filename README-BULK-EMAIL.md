# Bulk Email System

This system allows you to send bulk announcements to all users in the database with rich content support including images, links, and attachments.

## Features

- ✅ Send emails to all active users in the database
- ✅ Rich HTML email templates with images and links
- ✅ Support for both inline and block images
- ✅ Professional email layout using existing LORO base template
- ✅ Support for JSON and TXT email content files
- ✅ Filtering by organization, role, or specific email exclusions
- ✅ Dry-run mode for testing
- ✅ Batch processing with configurable delays
- ✅ Attachment support (images, documents, etc.)
- ✅ Comprehensive logging and error handling
- ✅ Beautiful, responsive email template
- ✅ Consistent branding with existing LORO emails

## Quick Start

### 1. Create your email content

#### Option A: JSON format (recommended)
Create a `.json` file with rich content:

```json
{
  "subject": "🚀 Important Company Announcement",
  "title": "Major Updates",
  "greeting": "Hello",
  "body": "<p>This is the main content of your announcement...</p><ul><li>Feature 1</li><li>Feature 2</li></ul>",
  "cta": {
    "text": "Learn More",
    "url": "https://example.com"
  },
  "images": [
    {
      "url": "https://example.com/banner.jpg",
      "alt": "Feature Banner",
      "title": "New Features Overview"
    },
    {
      "url": "https://example.com/icon.png",
      "alt": "Feature Icon",
      "width": 100,
      "height": 60,
      "inline": true
    }
  ],
  "links": [
    {
      "text": "Documentation",
      "url": "https://docs.example.com",
      "description": "Complete guide"
    }
  ],
  "footer": "<p>Additional footer content...</p>"
}
```

#### Option B: TXT format (simple)
Create a `.txt` file with plain text content:

```
Dear Team,

This is your announcement content...

Best regards,
Management
```

### 2. Run the bulk email script

```bash
# Dry run to preview recipients
npm run bulk-email -- -f announcement.json --dry-run

# Send to all users
npm run bulk-email -- -f announcement.json

# Send with custom options
npm run bulk-email -- -f message.txt -s "Custom Subject" -b 5 --delay 2000

# Filter by organization
npm run bulk-email -- -f content.json -o org1 org2

# Filter by roles
npm run bulk-email -- -f content.json -r admin manager

# Exclude specific emails
npm run bulk-email -- -f content.json -e user1@example.com user2@example.com
```

## Command Line Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--file` | `-f` | Path to email content file (required) | - |
| `--subject` | `-s` | Override email subject (for TXT files) | - |
| `--dry-run` | `-d` | Preview without sending emails | false |
| `--batch-size` | `-b` | Emails per batch | 10 |
| `--delay` | | Delay between batches (ms) | 1000 |
| `--organizations` | `-o` | Filter by organization IDs | - |
| `--roles` | `-r` | Filter by user roles | - |
| `--exclude-emails` | `-e` | Exclude specific emails | - |
| `--verbose` | `-v` | Enable detailed logging | false |

## Email Content Structure

### JSON Format Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `subject` | string | ✅ | Email subject line |
| `title` | string | ❌ | Main heading in email |
| `greeting` | string | ❌ | Greeting text (default: "Hello") |
| `body` | string | ✅ | Main content (supports HTML) |
| `cta` | object | ❌ | Call-to-action button |
| `images` | array | ❌ | Images to display |
| `links` | array | ❌ | Useful links section |
| `footer` | string | ❌ | Custom footer content |

### CTA Object
```json
{
  "text": "Button Text",
  "url": "https://example.com"
}
```

### Image Object
```json
{
  "url": "https://example.com/image.jpg",
  "alt": "Alt text",
  "title": "Image caption",
  "width": 600,
  "height": 300,
  "inline": false
}
```

**Image Types:**
- **Block Images** (`"inline": false` or omitted): Full-width images displayed as separate blocks
- **Inline Images** (`"inline": true`): Small images that display inline with text/paragraphs (recommended max 150x100px)

### Link Object
```json
{
  "text": "Link Text",
  "url": "https://example.com",
  "description": "Link description"
}
```

## Examples

### Basic Announcement
```bash
npm run bulk-email -- -f sample-simple.txt -s "Office Hours Update" --dry-run
```

### Rich Content with Images
```bash
npm run bulk-email -- -f sample-announcement.json -b 15 --delay 500
```

### Targeted to Specific Organizations
```bash
npm run bulk-email -- -f announcement.json -o "org-123" "org-456" --dry-run
```

### Management-Only Announcement
```bash
npm run bulk-email -- -f management-update.json -r admin manager supervisor
```

## Sample Files

Three sample files are included:

1. `sample-announcement.json` - Rich HTML announcement with images, links, and CTA
2. `sample-inline-images.json` - Example showing inline images mixed with content
3. `sample-simple.txt` - Simple text announcement

### Testing the New Template
```bash
# Test the inline images functionality
npm run bulk-email -- -f sample-inline-images.json --dry-run -v

# Test with the rich announcement template
npm run bulk-email -- -f sample-announcement.json --dry-run -v
```

## Best Practices

### 1. Always Test First
```bash
# Always run dry-run first to preview
npm run bulk-email -- -f your-content.json --dry-run -v
```

### 2. Use Appropriate Batch Sizes
- Small organizations (< 100 users): batch size 5-10
- Medium organizations (100-1000 users): batch size 10-20  
- Large organizations (> 1000 users): batch size 15-25

### 3. Content Guidelines
- Keep subject lines under 50 characters
- Use HTML sparingly in body content
- Test image URLs are accessible
- Include unsubscribe information if required
- Use clear, professional language

### 4. Timing Considerations
- Add delays between batches to avoid overwhelming email servers
- Send during business hours for better engagement
- Avoid sending on Fridays or before holidays

## Troubleshooting

### Common Issues

**"File not found" error**
- Ensure the file path is correct
- Use absolute paths if having issues

**"No recipients found"**
- Check your filter criteria
- Verify users exist and are active
- Use `--dry-run -v` to see detailed recipient info

**"SMTP connection failed"**
- Verify environment variables are set:
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_FROM`

**Emails not being received**
- Check spam folders
- Verify email addresses are correct
- Check server logs for delivery issues

### Debugging
```bash
# Enable verbose logging
npm run bulk-email -- -f content.json --dry-run -v

# Check help
npm run bulk-email:help
```

## Security & Compliance

- Only active, non-deleted users receive emails
- Invalid email addresses are automatically filtered
- All sent emails are logged in the database
- Failed deliveries are tracked and reported
- GDPR-compliant unsubscribe links can be included in templates

## Performance

- Batch processing prevents email server overload
- Configurable delays between batches
- Database queries are optimized for large user bases
- Memory-efficient processing of large recipient lists
- Comprehensive error handling and recovery

## Integration

The bulk email system integrates seamlessly with the existing LORO communication infrastructure:
- Uses existing email templates and styling
- Leverages current SMTP configuration
- Integrates with the communication logging system
- Supports the existing user management system

For additional support or feature requests, please contact the development team.
