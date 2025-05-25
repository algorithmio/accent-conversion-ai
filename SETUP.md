# Google Cloud Credentials Setup

## Step 1: Create a Google Cloud Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - **Speech-to-Text API**
   - **Text-to-Speech API**

## Step 2: Create Service Account

1. Go to **IAM & Admin** > **Service Accounts**
2. Click **Create Service Account**
3. Give it a name like "accent-converter"
4. Grant these roles:
   - **Cloud Speech Client**
   - **Cloud Text-to-Speech Client**
5. Click **Done**

## Step 3: Generate Credentials

1. Click on your newly created service account
2. Go to **Keys** tab
3. Click **Add Key** > **Create New Key**
4. Choose **JSON** format
5. Download the file

## Step 4: Setup Credentials File

1. Copy the downloaded JSON file to `config/creds.json` in your project
2. The file should look like this:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "accent-converter@your-project.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

## Step 5: Test Setup

Run the server to test if credentials are working:

```bash
node server.js
```

You should see: ✅ Using Google Cloud credentials from config/creds.json

## Security Notes

- ⚠️ **Never commit credentials to git** (already excluded in .gitignore)
- 🔒 Keep your credentials file secure
- 🔄 Rotate keys regularly for production use

## Troubleshooting

- **File not found**: Make sure `config/creds.json` exists
- **Invalid format**: Check JSON syntax with a validator
- **API errors**: Ensure APIs are enabled in Google Cloud Console
- **Permission errors**: Verify service account has correct roles 