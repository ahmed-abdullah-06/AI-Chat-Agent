// Request validation — rejects malformed payloads before they reach a provider.
import { badRequest } from './errors.js';
import { config } from './config.js';
import { isKnownProvider } from './providers.js';

const LIMITS = config.limits;
const ROLES = new Set(['user', 'assistant', 'system']);

function asString(value, field, { max = 1000, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field} is required.`, 'invalid_field');
    return undefined;
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be a string.`, 'invalid_field');
  const trimmed = value.trim();
  if (!trimmed && required) throw badRequest(`${field} cannot be empty.`, 'invalid_field');
  if (trimmed.length > max) throw badRequest(`${field} is too long (max ${max} characters).`, 'field_too_long');
  return trimmed;
}

export function validateChatBody(body = {}) {
  if (typeof body !== 'object' || body === null) throw badRequest('Invalid JSON body.');

  const provider = body.provider || 'gemini';
  if (!isKnownProvider(provider)) {
    throw badRequest(`Unknown provider "${provider}".`, 'unknown_provider');
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw badRequest('messages must be a non-empty array.', 'invalid_messages');
  }
  if (messages.length > LIMITS.messages) {
    throw badRequest(`Too many messages (max ${LIMITS.messages}). Send a new chat instead.`, 'too_many_messages');
  }

  const cleanMessages = messages.map((m, i) => {
    if (!m || typeof m !== 'object') throw badRequest(`Message ${i} is malformed.`, 'invalid_messages');
    if (!ROLES.has(m.role)) throw badRequest(`Message ${i} has an invalid role.`, 'invalid_messages');
    const content = asString(m.content, `Message ${i} content`, {
      max: LIMITS.messageChars,
      required: !Array.isArray(m.images) || m.images.length === 0
    });
    if (!content && (!Array.isArray(m.images) || !m.images.length)) {
      throw badRequest(`Message ${i} is empty.`, 'invalid_messages');
    }

    let images;
    if (Array.isArray(m.images) && m.images.length) {
      if (m.images.length > 4) throw badRequest('A message can carry at most 4 images.', 'too_many_images');
      images = m.images.map((img, j) => {
        if (!img || typeof img !== 'object') throw badRequest(`Image ${j} is malformed.`, 'invalid_image');
        const mimeType = String(img.mimeType || 'image/png');
        if (!/^image\/(png|jpe?g|webp|gif|avif)$/.test(mimeType)) {
          throw badRequest(`Image ${j} has an unsupported type.`, 'invalid_image');
        }
        const data = String(img.data || '');
        if (!data || data.length > 4_500_000) throw badRequest(`Image ${j} is too large.`, 'invalid_image');
        if (!/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 2000))) throw badRequest(`Image ${j} is malformed.`, 'invalid_image');
        return { mimeType, data };
      });
    }

    return { role: m.role, content: content || '', images };
  });

  const system = asString(body.system, 'system', { max: LIMITS.systemChars });
  const model = body.model === undefined || body.model === null ? undefined : asString(body.model, 'model', { max: 128 });

  let temperature;
  if (body.temperature !== undefined && body.temperature !== null && body.temperature !== '') {
    temperature = Number(body.temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw badRequest('temperature must be between 0 and 2.', 'invalid_temperature');
    }
  }

  let maxTokens;
  if (body.maxTokens !== undefined && body.maxTokens !== null && body.maxTokens !== '') {
    maxTokens = Number(body.maxTokens);
    if (!Number.isInteger(maxTokens) || maxTokens < 16 || maxTokens > 8192) {
      throw badRequest('maxTokens must be an integer between 16 and 8192.', 'invalid_max_tokens');
    }
  }

  return { provider, model, messages: cleanMessages, system, temperature, maxTokens };
}

export function validateNewsBody(body = {}) {
  const provider = body.provider || 'gemini';
  if (!isKnownProvider(provider)) throw badRequest(`Unknown provider "${provider}".`, 'unknown_provider');
  const model = body.model === undefined || body.model === null ? undefined : asString(body.model, 'model', { max: 128 });
  return { provider, model };
}
