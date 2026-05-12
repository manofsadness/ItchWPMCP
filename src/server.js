import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env'), quiet: true });

const baseUrl = normalizeBaseUrl(process.env.WP_BASE_URL);
const username = process.env.WP_USERNAME;
const appPassword = process.env.WP_APP_PASSWORD;
const allowProductionWrites = process.env.WP_ALLOW_PRODUCTION_WRITES === 'true';
const pageStatusSchema = z.enum(['publish', 'draft', 'pending', 'private', 'future']);
const contentStatusSchema = z.enum(['publish', 'draft', 'pending', 'private', 'future']);
const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const wpContentTypeSchema = z.enum(['page', 'post']);
const elementorDataSchema = z.union([z.string(), z.array(z.any()), z.record(z.string(), z.any())]);

if (!baseUrl || !username || !appPassword) {
  throw new Error('Missing WP_BASE_URL, WP_USERNAME, or WP_APP_PASSWORD in tools/wordpress-mcp/.env');
}

const server = new McpServer({
  name: 'ItchWPMCP',
  version: '1.0.0',
});

server.tool(
  'wordpress_list_pages',
  'List WordPress pages from the configured site.',
  {
    status: z.enum(['publish', 'draft', 'pending', 'private', 'future', 'any']).default('any'),
    perPage: z.number().int().min(1).max(100).default(100),
  },
  async ({ status, perPage }) => {
    const params = new URLSearchParams({
      per_page: String(perPage),
      orderby: 'menu_order',
      order: 'asc',
      _fields: 'id,date,modified,slug,status,title,link,menu_order',
    });

    if (status !== 'any') {
      params.set('status', status);
    }

    const pages = await wpFetch(`/wp-json/wp/v2/pages?${params.toString()}`);
    return jsonText(pages.map((page) => ({
      id: page.id,
      status: page.status,
      title: renderText(page.title),
      slug: page.slug,
      link: page.link,
      menu_order: page.menu_order,
      modified: page.modified,
    })));
  }
);

server.tool(
  'wordpress_list_posts',
  'List WordPress posts from the configured site.',
  {
    status: z.enum(['publish', 'draft', 'pending', 'private', 'future', 'any']).default('any'),
    perPage: z.number().int().min(1).max(100).default(100),
  },
  async ({ status, perPage }) => {
    const params = new URLSearchParams({
      per_page: String(perPage),
      orderby: 'date',
      order: 'desc',
      _fields: 'id,date,modified,slug,status,title,link,categories,tags,featured_media',
    });

    if (status !== 'any') {
      params.set('status', status);
    }

    const posts = await wpFetch(`/wp-json/wp/v2/posts?${params.toString()}`);
    return jsonText(posts.map(formatContentSummary));
  }
);

server.tool(
  'wordpress_get_post',
  'Get a WordPress post by ID from the configured site.',
  {
    id: z.number().int().positive(),
    context: z.enum(['view', 'edit']).default('edit'),
  },
  async ({ id, context }) => {
    const post = await wpFetch(`/wp-json/wp/v2/posts/${id}?context=${context}`);
    return jsonText(formatContentDetail(post));
  }
);

server.tool(
  'wordpress_get_page',
  'Get a WordPress page by ID from the configured site.',
  {
    id: z.number().int().positive(),
    context: z.enum(['view', 'edit']).default('edit'),
  },
  async ({ id, context }) => {
    const page = await wpFetch(`/wp-json/wp/v2/pages/${id}?context=${context}`);
    return jsonText({
      id: page.id,
      status: page.status,
      title: renderText(page.title),
      slug: page.slug,
      link: page.link,
      content: page.content?.raw ?? page.content?.rendered ?? '',
      excerpt: page.excerpt?.raw ?? page.excerpt?.rendered ?? '',
      modified: page.modified,
    });
  }
);

server.tool(
  'wordpress_create_post',
  'Create a WordPress post. Defaults to draft status for safe review before publishing.',
  {
    title: z.string().min(1),
    content: z.string().default(''),
    excerpt: z.string().optional(),
    slug: z.string().optional(),
    status: contentStatusSchema.default('draft'),
    categories: z.array(z.number().int().positive()).optional(),
    tags: z.array(z.number().int().positive()).optional(),
    featuredMedia: z.number().int().nonnegative().optional(),
  },
  async ({ title, content, excerpt, slug, status, categories, tags, featuredMedia }) => {
    assertWritesAllowed();

    const post = await wpFetch('/wp-json/wp/v2/posts', {
      method: 'POST',
      body: JSON.stringify(removeUndefined({
        title,
        content,
        excerpt,
        slug,
        status,
        categories,
        tags,
        featured_media: featuredMedia,
      })),
    });

    return jsonText(formatContentSummary(post));
  }
);

server.tool(
  'wordpress_update_post',
  'Update a WordPress post by ID.',
  {
    id: z.number().int().positive(),
    title: z.string().min(1).optional(),
    content: z.string().optional(),
    excerpt: z.string().optional(),
    slug: z.string().optional(),
    status: contentStatusSchema.optional(),
    categories: z.array(z.number().int().positive()).optional(),
    tags: z.array(z.number().int().positive()).optional(),
    featuredMedia: z.number().int().nonnegative().optional(),
  },
  async ({ id, title, content, excerpt, slug, status, categories, tags, featuredMedia }) => {
    assertWritesAllowed();

    const payload = removeUndefined({
      title,
      content,
      excerpt,
      slug,
      status,
      categories,
      tags,
      featured_media: featuredMedia,
    });

    assertPayloadNotEmpty(payload, 'wordpress_update_post');

    const post = await wpFetch(`/wp-json/wp/v2/posts/${id}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return jsonText(formatContentSummary(post));
  }
);

server.tool(
  'wordpress_create_page',
  'Create a WordPress page. Defaults to draft status for safe review before publishing.',
  {
    title: z.string().min(1),
    content: z.string().default(''),
    excerpt: z.string().optional(),
    slug: z.string().optional(),
    status: pageStatusSchema.default('draft'),
    parent: z.number().int().nonnegative().optional(),
    menuOrder: z.number().int().optional(),
  },
  async ({ title, content, excerpt, slug, status, parent, menuOrder }) => {
    assertWritesAllowed();

    const page = await wpFetch('/wp-json/wp/v2/pages', {
      method: 'POST',
      body: JSON.stringify(removeUndefined({
        title,
        content,
        excerpt,
        slug,
        status,
        parent,
        menu_order: menuOrder,
      })),
    });

    return jsonText(formatPageSummary(page));
  }
);

server.tool(
  'wordpress_clone_page',
  'Clone an existing WordPress page into a new draft page.',
  {
    sourceId: z.number().int().positive(),
    title: z.string().min(1),
    slug: z.string().optional(),
  },
  async ({ sourceId, title, slug }) => {
    assertWritesAllowed();

    const source = await wpFetch(`/wp-json/wp/v2/pages/${sourceId}?context=edit`);
    const page = await wpFetch('/wp-json/wp/v2/pages', {
      method: 'POST',
      body: JSON.stringify(removeUndefined({
        title,
        slug,
        status: 'draft',
        content: source.content?.raw ?? source.content?.rendered ?? '',
        excerpt: source.excerpt?.raw ?? source.excerpt?.rendered ?? '',
        template: source.template || '',
        parent: source.parent || 0,
        menu_order: source.menu_order || 0,
        meta: source.meta || undefined,
      })),
    });

    return jsonText(formatPageSummary(page));
  }
);

server.tool(
  'wordpress_update_page',
  'Update a WordPress page by ID. Only title, content, excerpt, slug, status, parent, and menu order are supported.',
  {
    id: z.number().int().positive(),
    title: z.string().min(1).optional(),
    content: z.string().optional(),
    excerpt: z.string().optional(),
    slug: z.string().optional(),
    status: pageStatusSchema.optional(),
    parent: z.number().int().nonnegative().optional(),
    menuOrder: z.number().int().optional(),
  },
  async ({ id, title, content, excerpt, slug, status, parent, menuOrder }) => {
    assertWritesAllowed();

    const payload = removeUndefined({
      title,
      content,
      excerpt,
      slug,
      status,
      parent,
      menu_order: menuOrder,
    });

    if (Object.keys(payload).length === 0) {
      throw new Error('wordpress_update_page requires at least one field to update.');
    }

    const page = await wpFetch(`/wp-json/wp/v2/pages/${id}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return jsonText(formatPageSummary(page));
  }
);

server.tool(
  'wordpress_delete_page',
  'Delete or trash a WordPress page. Requires confirmDelete=true.',
  {
    id: z.number().int().positive(),
    force: z.boolean().default(false),
    confirmDelete: z.boolean().default(false),
  },
  async ({ id, force, confirmDelete }) => {
    assertWritesAllowed();
    assertConfirmed(confirmDelete, 'wordpress_delete_page');
    const result = await wpFetch(`/wp-json/wp/v2/pages/${id}?force=${force ? 'true' : 'false'}`, { method: 'DELETE' });
    return jsonText(result);
  }
);

server.tool(
  'wordpress_delete_post',
  'Delete or trash a WordPress post. Requires confirmDelete=true.',
  {
    id: z.number().int().positive(),
    force: z.boolean().default(false),
    confirmDelete: z.boolean().default(false),
  },
  async ({ id, force, confirmDelete }) => {
    assertWritesAllowed();
    assertConfirmed(confirmDelete, 'wordpress_delete_post');
    const result = await wpFetch(`/wp-json/wp/v2/posts/${id}?force=${force ? 'true' : 'false'}`, { method: 'DELETE' });
    return jsonText(result);
  }
);

server.tool(
  'wordpress_update_page_status',
  'Update only the status for a WordPress page by ID.',
  {
    id: z.number().int().positive(),
    status: pageStatusSchema,
  },
  async ({ id, status }) => {
    assertWritesAllowed();

    const page = await wpFetch(`/wp-json/wp/v2/pages/${id}`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });

    return jsonText(formatPageSummary(page));
  }
);

server.tool(
  'wordpress_get_elementor_meta',
  'Get Elementor-related meta and template fields for a WordPress page or post.',
  {
    id: z.number().int().positive(),
    postType: wpContentTypeSchema.default('page'),
  },
  async ({ id, postType }) => {
    const item = await wpFetch(`/wp-json/wp/v2/${restBaseForContentType(postType)}/${id}?context=edit`);

    return jsonText({
      id: item.id,
      type: item.type,
      status: item.status,
      title: renderText(item.title),
      slug: item.slug,
      link: item.link,
      template: item.template ?? '',
      meta: pickElementorMeta(item.meta ?? {}),
    });
  }
);

server.tool(
  'wordpress_get_post_meta',
  'Get registered WordPress REST meta for a page or post. Use keys to limit the returned meta fields.',
  {
    id: z.number().int().positive(),
    postType: wpContentTypeSchema.default('page'),
    keys: z.array(z.string().min(1)).optional(),
  },
  async ({ id, postType, keys }) => {
    const item = await wpFetch(`/wp-json/wp/v2/${restBaseForContentType(postType)}/${id}?context=edit`);
    const meta = item.meta ?? {};

    return jsonText({
      id: item.id,
      type: item.type,
      status: item.status,
      title: renderText(item.title),
      slug: item.slug,
      link: item.link,
      template: item.template ?? '',
      meta: keys ? pickKeys(meta, keys) : meta,
    });
  }
);

server.tool(
  'wordpress_update_post_meta',
  'Update registered WordPress REST meta for a page or post. The target site must expose the meta keys in REST.',
  {
    id: z.number().int().positive(),
    postType: wpContentTypeSchema.default('page'),
    meta: z.record(z.string(), z.any()),
  },
  async ({ id, postType, meta }) => {
    assertWritesAllowed();
    assertPayloadNotEmpty(meta, 'wordpress_update_post_meta meta');

    const item = await wpFetch(`/wp-json/wp/v2/${restBaseForContentType(postType)}/${id}?context=edit`, {
      method: 'POST',
      body: JSON.stringify({ meta }),
    });

    return jsonText({
      id: item.id,
      type: item.type,
      status: item.status,
      title: renderText(item.title),
      slug: item.slug,
      link: item.link,
      template: item.template ?? '',
      meta: pickKeys(item.meta ?? {}, Object.keys(meta)),
    });
  }
);

server.tool(
  'wordpress_update_elementor_meta',
  'Update Elementor post meta for a WordPress page or post. Supports _elementor_data, _elementor_edit_mode, _elementor_template_type, _elementor_version, _elementor_page_settings, and _wp_page_template.',
  {
    id: z.number().int().positive(),
    postType: wpContentTypeSchema.default('page'),
    elementorData: elementorDataSchema.optional(),
    elementorEditMode: z.string().min(1).optional(),
    elementorTemplateType: z.string().min(1).optional(),
    elementorVersion: z.string().min(1).optional(),
    elementorPageSettings: z.record(z.string(), z.any()).optional(),
    wpPageTemplate: z.string().min(1).optional(),
  },
  async ({
    id,
    postType,
    elementorData,
    elementorEditMode,
    elementorTemplateType,
    elementorVersion,
    elementorPageSettings,
    wpPageTemplate,
  }) => {
    assertWritesAllowed();

    const meta = removeUndefined({
      _elementor_data: elementorData === undefined ? undefined : normalizeElementorData(elementorData),
      _elementor_edit_mode: elementorEditMode,
      _elementor_template_type: elementorTemplateType,
      _elementor_version: elementorVersion,
      _elementor_page_settings: elementorPageSettings,
      _wp_page_template: wpPageTemplate,
    });

    const payload = removeUndefined({
      meta: Object.keys(meta).length > 0 ? meta : undefined,
      template: postType === 'page' ? wpPageTemplate : undefined,
    });

    assertPayloadNotEmpty(payload, 'wordpress_update_elementor_meta');

    const item = await wpFetch(`/wp-json/wp/v2/${restBaseForContentType(postType)}/${id}?context=edit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return jsonText({
      id: item.id,
      type: item.type,
      status: item.status,
      title: renderText(item.title),
      slug: item.slug,
      link: item.link,
      template: item.template ?? '',
      meta: pickElementorMeta(item.meta ?? {}),
    });
  }
);

server.tool(
  'wordpress_update_elementor_data',
  'Update only _elementor_data for a WordPress page or post. Pass Elementor data as a JSON string, object, or array.',
  {
    id: z.number().int().positive(),
    postType: wpContentTypeSchema.default('page'),
    elementorData: elementorDataSchema,
  },
  async ({ id, postType, elementorData }) => {
    assertWritesAllowed();

    const item = await wpFetch(`/wp-json/wp/v2/${restBaseForContentType(postType)}/${id}?context=edit`, {
      method: 'POST',
      body: JSON.stringify({
        meta: {
          _elementor_data: normalizeElementorData(elementorData),
        },
      }),
    });

    return jsonText({
      id: item.id,
      type: item.type,
      status: item.status,
      title: renderText(item.title),
      slug: item.slug,
      link: item.link,
      meta: pickElementorMeta(item.meta ?? {}),
    });
  }
);

server.tool(
  'wordpress_list_elementor_routes',
  'List Elementor REST API routes exposed by the configured WordPress site.',
  {},
  async () => {
    const root = await wpFetch('/wp-json/');
    const routes = Object.entries(root.routes ?? {})
      .filter(([route]) => route.startsWith('/elementor/'))
      .map(([route, definition]) => ({
        route,
        namespace: definition.namespace,
        methods: [...new Set((definition.methods ?? []).flat())],
      }));

    return jsonText({
      namespaces: (root.namespaces ?? []).filter((namespace) => namespace.startsWith('elementor')),
      routes,
    });
  }
);

server.tool(
  'wordpress_elementor_rest_request',
  'Advanced escape hatch for Elementor REST API calls only. Non-GET requests obey write guards.',
  {
    method: httpMethodSchema.default('GET'),
    path: z.string().min(1),
    body: z.record(z.string(), z.any()).optional(),
    confirmDelete: z.boolean().default(false),
  },
  async ({ method, path, body, confirmDelete }) => {
    const normalizedPath = normalizeElementorRestPath(path);
    if (method !== 'GET') {
      assertWritesAllowed();
    }
    if (method === 'DELETE') {
      assertConfirmed(confirmDelete, 'wordpress_elementor_rest_request DELETE');
    }

    return jsonText(await wpFetch(normalizedPath, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  }
);

server.tool(
  'wordpress_list_media',
  'List media library items.',
  {
    search: z.string().optional(),
    perPage: z.number().int().min(1).max(100).default(50),
  },
  async ({ search, perPage }) => {
    const params = new URLSearchParams({
      per_page: String(perPage),
      orderby: 'date',
      order: 'desc',
      _fields: 'id,date,modified,slug,status,title,link,source_url,media_type,mime_type,alt_text,caption',
    });

    if (search) {
      params.set('search', search);
    }

    const media = await wpFetch(`/wp-json/wp/v2/media?${params.toString()}`);
    return jsonText(media.map((item) => ({
      id: item.id,
      title: renderText(item.title),
      media_type: item.media_type,
      mime_type: item.mime_type,
      source_url: item.source_url,
      alt_text: item.alt_text,
      modified: item.modified,
    })));
  }
);

server.tool(
  'wordpress_upload_media',
  'Upload a local file to the WordPress media library.',
  {
    filePath: z.string().min(1),
    title: z.string().optional(),
    altText: z.string().optional(),
    caption: z.string().optional(),
  },
  async ({ filePath, title, altText, caption }) => {
    assertWritesAllowed();

    const bytes = await readFile(filePath);
    const filename = filePath.split(/[\\/]/).pop() || 'upload.bin';
    const media = await wpFetch('/wp-json/wp/v2/media', {
      method: 'POST',
      body: bytes,
      headers: {
        'Content-Disposition': `attachment; filename="${filename.replaceAll('"', '')}"`,
        'Content-Type': guessMimeType(filename),
      },
    });

    const metaPayload = removeUndefined({
      title,
      alt_text: altText,
      caption,
    });

    if (Object.keys(metaPayload).length > 0) {
      const updated = await wpFetch(`/wp-json/wp/v2/media/${media.id}`, {
        method: 'POST',
        body: JSON.stringify(metaPayload),
      });
      return jsonText(updated);
    }

    return jsonText(media);
  }
);

server.tool(
  'wordpress_list_categories',
  'List WordPress post categories.',
  {
    search: z.string().optional(),
    perPage: z.number().int().min(1).max(100).default(100),
  },
  async ({ search, perPage }) => {
    const params = new URLSearchParams({ per_page: String(perPage), _fields: 'id,count,name,slug,description,parent,link' });
    if (search) params.set('search', search);
    return jsonText(await wpFetch(`/wp-json/wp/v2/categories?${params.toString()}`));
  }
);

server.tool(
  'wordpress_create_category',
  'Create a WordPress post category.',
  {
    name: z.string().min(1),
    slug: z.string().optional(),
    description: z.string().optional(),
    parent: z.number().int().nonnegative().optional(),
  },
  async ({ name, slug, description, parent }) => {
    assertWritesAllowed();
    return jsonText(await wpFetch('/wp-json/wp/v2/categories', {
      method: 'POST',
      body: JSON.stringify(removeUndefined({ name, slug, description, parent })),
    }));
  }
);

server.tool(
  'wordpress_list_tags',
  'List WordPress post tags.',
  {
    search: z.string().optional(),
    perPage: z.number().int().min(1).max(100).default(100),
  },
  async ({ search, perPage }) => {
    const params = new URLSearchParams({ per_page: String(perPage), _fields: 'id,count,name,slug,description,link' });
    if (search) params.set('search', search);
    return jsonText(await wpFetch(`/wp-json/wp/v2/tags?${params.toString()}`));
  }
);

server.tool(
  'wordpress_create_tag',
  'Create a WordPress post tag.',
  {
    name: z.string().min(1),
    slug: z.string().optional(),
    description: z.string().optional(),
  },
  async ({ name, slug, description }) => {
    assertWritesAllowed();
    return jsonText(await wpFetch('/wp-json/wp/v2/tags', {
      method: 'POST',
      body: JSON.stringify(removeUndefined({ name, slug, description })),
    }));
  }
);

server.tool(
  'wordpress_list_plugins',
  'List WordPress plugins if the configured user can access the plugins REST endpoint.',
  {},
  async () => {
    const plugins = await wpFetch('/wp-json/wp/v2/plugins');
    return jsonText(plugins.map((plugin) => ({
      plugin: plugin.plugin,
      name: plugin.name,
      status: plugin.status,
      version: plugin.version,
    })));
  }
);

server.tool(
  'wordpress_update_plugin_status',
  'Activate or deactivate an installed plugin if the authenticated user has permission.',
  {
    plugin: z.string().min(1),
    status: z.enum(['active', 'inactive']),
  },
  async ({ plugin, status }) => {
    assertWritesAllowed();
    const encodedPlugin = plugin.split('/').map(encodeURIComponent).join('/');
    return jsonText(await wpFetch(`/wp-json/wp/v2/plugins/${encodedPlugin}`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }));
  }
);

server.tool(
  'wordpress_get_settings',
  'Get general WordPress site settings if the authenticated user has permission.',
  {},
  async () => jsonText(await wpFetch('/wp-json/wp/v2/settings'))
);

server.tool(
  'wordpress_update_settings',
  'Update general WordPress site settings. Only provided fields are changed.',
  {
    title: z.string().optional(),
    description: z.string().optional(),
    timezone: z.string().optional(),
    dateFormat: z.string().optional(),
    timeFormat: z.string().optional(),
    startOfWeek: z.number().int().min(0).max(6).optional(),
    defaultCategory: z.number().int().positive().optional(),
    defaultPostFormat: z.string().optional(),
    postsPerPage: z.number().int().positive().optional(),
    showOnFront: z.enum(['posts', 'page']).optional(),
    pageOnFront: z.number().int().nonnegative().optional(),
    pageForPosts: z.number().int().nonnegative().optional(),
  },
  async (input) => {
    assertWritesAllowed();
    const payload = removeUndefined({
      title: input.title,
      description: input.description,
      timezone: input.timezone,
      date_format: input.dateFormat,
      time_format: input.timeFormat,
      start_of_week: input.startOfWeek,
      default_category: input.defaultCategory,
      default_post_format: input.defaultPostFormat,
      posts_per_page: input.postsPerPage,
      show_on_front: input.showOnFront,
      page_on_front: input.pageOnFront,
      page_for_posts: input.pageForPosts,
    });
    assertPayloadNotEmpty(payload, 'wordpress_update_settings');
    return jsonText(await wpFetch('/wp-json/wp/v2/settings', { method: 'POST', body: JSON.stringify(payload) }));
  }
);

server.tool(
  'wordpress_list_users',
  'List WordPress users if the authenticated user has permission.',
  {
    search: z.string().optional(),
    perPage: z.number().int().min(1).max(100).default(50),
  },
  async ({ search, perPage }) => {
    const params = new URLSearchParams({ per_page: String(perPage), _fields: 'id,name,slug,link,roles' });
    if (search) params.set('search', search);
    return jsonText(await wpFetch(`/wp-json/wp/v2/users?${params.toString()}`));
  }
);

server.tool(
  'wordpress_list_menus',
  'List menus if the WordPress menus REST endpoint is available.',
  {},
  async () => jsonText(await wpFetch('/wp-json/wp/v2/menus'))
);

server.tool(
  'wordpress_list_menu_items',
  'List menu items if the WordPress menu-items REST endpoint is available.',
  {
    menus: z.number().int().positive().optional(),
    perPage: z.number().int().min(1).max(100).default(100),
  },
  async ({ menus, perPage }) => {
    const params = new URLSearchParams({ per_page: String(perPage) });
    if (menus) params.set('menus', String(menus));
    return jsonText(await wpFetch(`/wp-json/wp/v2/menu-items?${params.toString()}`));
  }
);

server.tool(
  'wordpress_rest_request',
  'Advanced escape hatch for WordPress REST API calls. Non-GET requests obey write guards.',
  {
    method: httpMethodSchema.default('GET'),
    path: z.string().min(1),
    body: z.record(z.any()).optional(),
    confirmDelete: z.boolean().default(false),
  },
  async ({ method, path, body, confirmDelete }) => {
    const normalizedPath = normalizeRestPath(path);
    if (method !== 'GET') {
      assertWritesAllowed();
    }
    if (method === 'DELETE') {
      assertConfirmed(confirmDelete, 'wordpress_rest_request DELETE');
    }

    return jsonText(await wpFetch(normalizedPath, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

async function wpFetch(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`WordPress returned non-JSON response (${response.status}): ${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    throw new Error(`WordPress REST error (${response.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

function normalizeBaseUrl(value) {
  return value ? value.replace(/\/+$/, '') : '';
}

function renderText(field) {
  return field?.raw ?? field?.rendered ?? '';
}

function formatContentSummary(item) {
  return {
    id: item.id,
    status: item.status,
    title: renderText(item.title),
    slug: item.slug,
    link: item.link,
    modified: item.modified,
    categories: item.categories,
    tags: item.tags,
    featured_media: item.featured_media,
  };
}

function formatContentDetail(item) {
  return {
    ...formatContentSummary(item),
    content: item.content?.raw ?? item.content?.rendered ?? '',
    excerpt: item.excerpt?.raw ?? item.excerpt?.rendered ?? '',
  };
}

function assertWritesAllowed() {
  if (isStagingUrl(baseUrl) || allowProductionWrites) {
    return;
  }

  throw new Error(
    'Write tools are blocked for non-staging URLs. Set WP_ALLOW_PRODUCTION_WRITES=true in .env to allow production writes.'
  );
}

function assertConfirmed(confirmed, operation) {
  if (!confirmed) {
    throw new Error(`${operation} requires confirmDelete=true.`);
  }
}

function assertPayloadNotEmpty(payload, toolName) {
  if (Object.keys(payload).length === 0) {
    throw new Error(`${toolName} requires at least one field to update.`);
  }
}

function isStagingUrl(value) {
  return /\bstaging\b/i.test(value);
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function pickKeys(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function restBaseForContentType(postType) {
  return postType === 'page' ? 'pages' : 'posts';
}

function normalizeElementorData(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function pickElementorMeta(meta) {
  return {
    _elementor_data: meta._elementor_data,
    _elementor_edit_mode: meta._elementor_edit_mode,
    _elementor_template_type: meta._elementor_template_type,
    _elementor_version: meta._elementor_version,
    _elementor_page_settings: meta._elementor_page_settings,
    _wp_page_template: meta._wp_page_template,
  };
}

function normalizeRestPath(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;

  if (!normalized.startsWith('/wp-json/')) {
    throw new Error('REST path must start with /wp-json/.');
  }

  return normalized;
}

function normalizeElementorRestPath(path) {
  const normalized = normalizeRestPath(path);

  if (!/^\/wp-json\/elementor(?:-[a-z0-9]+)?\/v\d+\//i.test(normalized)) {
    throw new Error('Elementor REST path must start with /wp-json/elementor*/vN/.');
  }

  return normalized;
}

function guessMimeType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

function formatPageSummary(page) {
  return {
    id: page.id,
    status: page.status,
    title: renderText(page.title),
    slug: page.slug,
    link: page.link,
    modified: page.modified,
  };
}

function jsonText(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
