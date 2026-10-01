import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { avatars, errorMessage } from '../lib/api';
import { squareImage } from '../lib/image';
import { useFeedback } from './overlay';
import { Avatar, Spinner } from './ui';

/**
 * Foto de perfil con botón para cambiarla. La imagen se recorta en cuadrado,
 * se reduce y se sube al momento; `onChange` recibe la nueva URL (o null al quitarla).
 */
export function PhotoPicker({
  name,
  color,
  src,
  size = 96,
  folder,
  onChange,
  removeOld = true,
}: {
  name: string;
  color?: string;
  src?: string | null;
  size?: number;
  /** Carpeta de almacenamiento: el id del empleado */
  folder: string;
  onChange: (url: string | null) => Promise<void> | void;
  /** Borrar el archivo anterior al cambiarla (no en formularios que aún se pueden cancelar) */
  removeOld?: boolean;
}) {
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Elige una imagen (JPG, PNG o HEIC)');
    setBusy(true);
    try {
      const image = await squareImage(file, 512);
      const url = await avatars.upload(folder, image);
      await onChange(url);
      if (removeOld) await avatars.remove(src).catch(() => {});
      toast.success(removeOld ? 'Foto actualizada' : 'Foto lista: pulsa Guardar para aplicarla');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    if (!(await confirm({ title: '¿Quitar la foto?', confirmLabel: 'Quitar', destructive: true }))) return;
    setBusy(true);
    try {
      await onChange(null);
      if (removeOld) await avatars.remove(src).catch(() => {});
      toast.success('Foto eliminada');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="group relative rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30"
        aria-label="Cambiar foto"
      >
        <Avatar name={name} color={color} src={src} size={size} />
        <span className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full border-2 border-surface bg-accent text-on-accent shadow-sm transition group-hover:scale-105 dark:border-elevated">
          {busy ? <Spinner className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
        </span>
      </button>
      <div className="flex items-center gap-3 text-[13px] font-medium">
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="text-accent hover:opacity-70">
          {src ? 'Cambiar foto' : 'Añadir foto'}
        </button>
        {src && (
          <button type="button" onClick={remove} disabled={busy} className="text-red hover:opacity-70">
            Quitar
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}
