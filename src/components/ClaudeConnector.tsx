import { useState } from 'react';
import { Copy, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useLoad } from '../hooks';
import { api, errorMessage } from '../lib/api';
import { CLAUDE_FUNCTION, IS_DEMO, SUPABASE_URL } from '../lib/config';
import { fmtDate } from '../lib/format';
import type { ClaudeConnector } from '../lib/types';
import { Modal, useFeedback } from './overlay';
import { Button, Card, CardHeader, Field, IconButton, Input, ListRow } from './ui';

/** Código secreto del enlace: 32 bytes aleatorios en base64url */
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const connectorUrl = (token: string) => `${SUPABASE_URL?.replace(/\/$/, '')}/functions/v1/${CLAUDE_FUNCTION}/${token}`;

/**
 * Enlaces del conector de Claude: con uno de ellos, Claude puede registrar movimientos
 * en Finanzas, subir facturas y crear proveedores (función "rapid-responder" de Supabase).
 */
export function ClaudeConnectorCard() {
  const { toast, confirm } = useFeedback();
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('Claude');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const { data: links, reload } = useLoad(() => (IS_DEMO ? Promise.resolve([] as ClaudeConnector[]) : api.claudeConnectors.list({ order: ['created_at', 'desc'] })), []);

  async function create() {
    setSaving(true);
    try {
      const token = newToken();
      await api.claudeConnectors.create({ label: label.trim() || 'Claude', token_hash: await sha256(token), token_hint: token.slice(-4) });
      setCreating(false);
      setCreated(connectorUrl(token));
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function revoke(link: ClaudeConnector) {
    const ok = await confirm({
      title: '¿Desactivar este enlace?',
      message: `Claude dejará de tener acceso con el enlace "${link.label}" (…${link.token_hint ?? ''}).`,
      confirmLabel: 'Desactivar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.claudeConnectors.remove(link.id);
      toast.success('Enlace desactivado');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Enlace copiado');
    } catch {
      toast.error('No se ha podido copiar: selecciónalo y cópialo a mano');
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" /> Conector de Claude
          </span>
        }
        subtitle="Pásale a Claude extractos, tickets o facturas y los registrará en Finanzas y Facturas (creando los proveedores que falten)."
      />
      <div className="px-5 pb-5">
        {IS_DEMO ? (
          <p className="text-[13px] text-ink-2">Disponible solo con Supabase conectado (no en el modo demo).</p>
        ) : (
          <>
            {!!links?.length && (
              <div className="-mx-4 mb-3 divide-y divide-line">
                {links.map((l) => (
                  <ListRow
                    key={l.id}
                    title={`${l.label} · …${l.token_hint ?? ''}`}
                    subtitle={`Creado el ${fmtDate(l.created_at.slice(0, 10))} · ${l.last_used_at ? `último uso ${fmtDate(l.last_used_at.slice(0, 10))}` : 'sin usar todavía'}`}
                    trailing={
                      <IconButton label="Desactivar enlace" onClick={() => revoke(l)} className="hover:text-red">
                        <Trash2 />
                      </IconButton>
                    }
                  />
                ))}
              </div>
            )}
            <Button variant="secondary" className="w-full" icon={<Plus />} onClick={() => (setLabel(links?.length ? `Claude ${links.length + 1}` : 'Claude'), setCreating(true))}>
              {links?.length ? 'Generar otro enlace' : 'Conectar con Claude'}
            </Button>
          </>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Conectar con Claude" onSubmit={create} submitLabel="Generar" saving={saving}>
        <div className="space-y-4">
          <Field label="Nombre del enlace" hint="Para reconocerlo luego, p. ej. “Claude de Óscar”">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <p className="text-[13px] text-ink-2">
            Quien tenga el enlace podrá ver y registrar movimientos, facturas y proveedores en tu nombre. No lo compartas; si se filtra, desactívalo aquí y genera otro.
          </p>
        </div>
      </Modal>

      <Modal open={!!created} onClose={() => setCreated(null)} title="Enlace del conector">
        {created && (
          <div className="space-y-4 text-[14px]">
            <p className="text-ink-2">Cópialo ahora: por seguridad no se vuelve a mostrar.</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={created} onFocus={(e) => e.target.select()} className="font-mono text-[12px]" />
              <IconButton label="Copiar enlace" onClick={() => copy(created)}>
                <Copy />
              </IconButton>
            </div>
            <ol className="list-decimal space-y-1.5 pl-5 text-ink-2">
              <li>
                En Claude (web o app de escritorio) ve a <b className="text-ink">Ajustes → Conectores → Añadir conector personalizado</b>.
              </li>
              <li>
                Ponle de nombre <b className="text-ink">Vizzio</b>, pega el enlace en “URL del servidor MCP remoto” y pulsa <b className="text-ink">Añadir</b>.
              </li>
              <li>En un chat, activa el conector Vizzio en el menú de herramientas y pásale los archivos.</li>
            </ol>
            <Button className="w-full" icon={<Copy />} onClick={() => copy(created)}>
              Copiar enlace
            </Button>
          </div>
        )}
      </Modal>
    </Card>
  );
}
