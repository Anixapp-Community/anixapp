import { writable } from 'svelte/store';

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Красная кнопка подтверждения (удаление, выход) */
  danger?: boolean;
};

type ConfirmState = (ConfirmOptions & { resolve: (value: boolean) => void }) | null;

export const confirmState = writable<ConfirmState>(null);

/** Показать подтверждение и дождаться ответа (замена window.confirm). */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.set({ ...options, resolve });
  });
}

export function resolveConfirm(value: boolean): void {
  confirmState.update((state) => {
    state?.resolve(value);
    return null;
  });
}
