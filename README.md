# ItchWPMCP

Local MCP server for Codex/Claude to query and edit WordPress content through the WordPress REST API.

It can be used with any WordPress site that has the REST API enabled and supports Application Password authentication.

## Setup

1. Create a WordPress application password:
   `WordPress Admin -> Users -> Profile -> Application Passwords`

2. Copy `.env.example` to `.env` and fill in:

   ```env
   WP_BASE_URL=https://your-wordpress-site.example
   WP_USERNAME=your-wordpress-username
   WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
   WP_ALLOW_PRODUCTION_WRITES=false
   ```

3. Install dependencies:

   ```sh
   npm install
   ```

4. Run the server:

   ```sh
   npm start
   ```

   If Node cannot verify your site's certificate chain, set `NODE_OPTIONS=--use-system-ca` in your MCP client environment.

## Tools

- `wordpress_list_pages`: list WordPress pages.
- `wordpress_get_page`: get a page by ID.
- `wordpress_create_page`: create a page, defaulting to draft status.
- `wordpress_clone_page`: clone an existing page into a new draft page.
- `wordpress_update_page`: update title, content, excerpt, slug, status, parent, or menu order.
- `wordpress_update_page_status`: update only a page status.
- `wordpress_delete_page`: trash or delete a page with confirmation.
- `wordpress_list_posts`: list WordPress posts.
- `wordpress_get_post`: get a post by ID.
- `wordpress_create_post`: create a post, defaulting to draft status.
- `wordpress_update_post`: update a post.
- `wordpress_delete_post`: trash or delete a post with confirmation.
- `wordpress_list_media`: list media library items.
- `wordpress_upload_media`: upload a local file to the media library.
- `wordpress_list_categories`: list post categories.
- `wordpress_create_category`: create a post category.
- `wordpress_list_tags`: list post tags.
- `wordpress_create_tag`: create a post tag.
- `wordpress_list_plugins`: list plugins if the authenticated user has permission.
- `wordpress_update_plugin_status`: activate or deactivate an installed plugin.
- `wordpress_get_settings`: read general site settings.
- `wordpress_update_settings`: update selected general site settings.
- `wordpress_list_users`: list users if the authenticated user has permission.
- `wordpress_list_menus`: list menus if the REST endpoint is available.
- `wordpress_list_menu_items`: list menu items if the REST endpoint is available.
- `wordpress_get_elementor_meta`: read Elementor-related meta and template fields for a page or post.
- `wordpress_update_elementor_meta`: update `_elementor_data`, `_elementor_edit_mode`, `_elementor_template_type`, `_elementor_version`, `_elementor_page_settings`, and `_wp_page_template` for a page or post.
- `wordpress_list_elementor_routes`: list Elementor REST API routes exposed by the configured WordPress site.
- `wordpress_rest_request`: advanced REST API escape hatch.

Write tools are enabled on staging URLs. If `WP_BASE_URL` is changed to production, writes are blocked unless `WP_ALLOW_PRODUCTION_WRITES=true` is set in `.env`.

## Elementor Meta Tools

Use `wordpress_update_elementor_meta` when you need to save Elementor layout data through WordPress REST. Pass `elementorData` as either a JSON string or a JSON object/array; the tool stores it as `_elementor_data`.

Example:

```json
{
  "id": 123,
  "postType": "page",
  "elementorEditMode": "builder",
  "elementorTemplateType": "wp-page",
  "elementorVersion": "3.30.0",
  "wpPageTemplate": "elementor_canvas",
  "elementorData": []
}
```

The available Elementor REST endpoints depend on the target WordPress site and installed Elementor plugins. Use `wordpress_list_elementor_routes` to inspect what the configured site exposes.

## Use Another WordPress Site

Create an Application Password in that WordPress site's admin, then update `.env`:

```env
WP_BASE_URL=https://another-wordpress-site.example
WP_USERNAME=your-wordpress-username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
WP_ALLOW_PRODUCTION_WRITES=false
```

Keep `WP_ALLOW_PRODUCTION_WRITES=false` until you intentionally want write tools enabled on a production URL.

## Port It For Another Person

1. Copy this `ItchWPMCP` folder to their machine or publish it as a private/public repo.
2. Run `npm install` inside the folder.
3. Create a `.env` file from `.env.example`.
4. In their WordPress admin, create an Application Password:
   `Users -> Profile -> Application Passwords`
5. Put their site URL, username, and app password in `.env`.
6. Register the MCP server in their MCP client.

Do not commit `.env` files. Application Passwords should stay local to each user/site.

## Codex Config

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.itch_wp_mcp]
command = "node"
args = ["<absolute-path-to-ItchWPMCP>/src/server.js"]
enabled = true
startup_timeout_sec = 20
tool_timeout_sec = 60

[mcp_servers.itch_wp_mcp.env]
WP_BASE_URL = "https://your-wordpress-site.example"
WP_USERNAME = "your-wordpress-username"
WP_APP_PASSWORD = "xxxx xxxx xxxx xxxx xxxx xxxx"
WP_ALLOW_PRODUCTION_WRITES = "false"
NODE_OPTIONS = "--use-system-ca"
```

If your MCP client cannot find `node`, set `command` to the absolute path of your Node executable. For example:

```toml
command = "<absolute-path-to-node>"
```

## Claude Desktop Config

Add this to Claude Desktop's `claude_desktop_config.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "itch_wp_mcp": {
      "command": "node",
      "args": [
        "<absolute-path-to-ItchWPMCP>/src/server.js"
      ],
      "env": {
        "WP_BASE_URL": "https://your-wordpress-site.example",
        "WP_USERNAME": "your-wordpress-username",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx",
        "WP_ALLOW_PRODUCTION_WRITES": "false",
        "NODE_OPTIONS": "--use-system-ca"
      }
    }
  }
}
```

Restart Claude Desktop after changing the config.

## Multi-Site Setup

You do not need a separate copy of ItchWPMCP for every WordPress website. Keep one codebase and register multiple MCP servers, each with different environment variables.

### Codex Multi-Site Example

```toml
[mcp_servers.wp_site_staging]
command = "node"
args = ["<absolute-path-to-ItchWPMCP>/src/server.js"]
enabled = true
startup_timeout_sec = 20
tool_timeout_sec = 60

[mcp_servers.wp_site_staging.env]
WP_BASE_URL = "https://staging.example.com"
WP_USERNAME = "site-admin"
WP_APP_PASSWORD = "xxxx xxxx xxxx xxxx xxxx xxxx"
WP_ALLOW_PRODUCTION_WRITES = "false"
NODE_OPTIONS = "--use-system-ca"

[mcp_servers.wp_client_site]
command = "node"
args = ["<absolute-path-to-ItchWPMCP>/src/server.js"]
enabled = true
startup_timeout_sec = 20
tool_timeout_sec = 60

[mcp_servers.wp_client_site.env]
WP_BASE_URL = "https://client-site.example"
WP_USERNAME = "client-admin"
WP_APP_PASSWORD = "xxxx xxxx xxxx xxxx xxxx xxxx"
WP_ALLOW_PRODUCTION_WRITES = "false"
NODE_OPTIONS = "--use-system-ca"
```

### Claude Multi-Site Example

```json
{
  "mcpServers": {
    "wp_site_staging": {
      "command": "node",
      "args": ["<absolute-path-to-ItchWPMCP>/src/server.js"],
      "env": {
        "WP_BASE_URL": "https://staging.example.com",
        "WP_USERNAME": "site-admin",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx",
        "WP_ALLOW_PRODUCTION_WRITES": "false",
        "NODE_OPTIONS": "--use-system-ca"
      }
    },
    "wp_client_site": {
      "command": "node",
      "args": ["<absolute-path-to-ItchWPMCP>/src/server.js"],
      "env": {
        "WP_BASE_URL": "https://client-site.example",
        "WP_USERNAME": "client-admin",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx",
        "WP_ALLOW_PRODUCTION_WRITES": "false",
        "NODE_OPTIONS": "--use-system-ca"
      }
    }
  }
}
```

The `.env` file is now only a local fallback. Per-site MCP environment variables take precedence when provided by Codex or Claude.

## Safety Model

- New pages/posts default to `draft`.
- Destructive tools require `confirmDelete=true`.
- Non-staging writes are blocked unless `WP_ALLOW_PRODUCTION_WRITES=true`.
- `wordpress_rest_request` only allows paths under `/wp-json/`.
