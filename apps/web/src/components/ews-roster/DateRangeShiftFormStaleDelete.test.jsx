import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import {
  REASON, staleError, deletePreview, openDeleteDialog,
} from './staleTestHelpers';

describe('PREVIEW_STALE — deteksi via err.code (DELETE)', () => {
  it('refresh berhasil: alasan dipertahankan, konfirmasi ulang wajib, retry memakai token baru', async () => {
    const user = userEvent.setup();
    const onPreviewDelete = vi.fn()
      .mockResolvedValueOnce(deletePreview('tok_del_1'))
      .mockResolvedValueOnce(deletePreview('tok_del_2'));
    const onDelete = vi.fn().mockRejectedValueOnce(staleError()).mockResolvedValueOnce({ ok: true });
    const ui = await openDeleteDialog(user, { onPreviewDeleteOverride: onPreviewDelete, onDeleteOverride: onDelete });

    await user.type(ui.reason, REASON);
    await user.click(ui.checkbox());
    await user.click(ui.submit());

    await waitFor(() => expect(onPreviewDelete).toHaveBeenCalledTimes(2));
    expect(onDelete.mock.calls[0][1].preview_token).toBe('tok_del_1');
    await screen.findByText(/Preview diperbarui, centang konfirmasi ulang/i);
    expect(ui.reason.value).toBe(REASON);
    expect(ui.checkbox().checked).toBe(false);
    expect(ui.submit().disabled).toBe(true);

    await user.click(ui.checkbox());
    await user.click(ui.submit());
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2));
    expect(onDelete.mock.calls[1][0]).toBe(202);
    expect(onDelete.mock.calls[1][1]).toMatchObject({ preview_token: 'tok_del_2', reason: REASON, confirm_today_impact: true });
    await waitFor(() => expect(screen.queryByText('Konfirmasi Hapus Jam Khusus Hari Ini')).toBeNull());
  });

  it('refresh gagal: submit terkunci, tidak ada delete ulang dengan token lama; refresh manual lalu retry token baru', async () => {
    const user = userEvent.setup();
    const onPreviewDelete = vi.fn()
      .mockResolvedValueOnce(deletePreview('tok_del_1'))
      .mockRejectedValueOnce(Object.assign(new Error('Koneksi database terputus'), { status: 503 }))
      .mockResolvedValueOnce(deletePreview('tok_del_3'));
    const onDelete = vi.fn().mockRejectedValueOnce(staleError()).mockResolvedValueOnce({ ok: true });
    const ui = await openDeleteDialog(user, { onPreviewDeleteOverride: onPreviewDelete, onDeleteOverride: onDelete });

    await user.type(ui.reason, REASON);
    await user.click(ui.checkbox());
    await user.click(ui.submit());

    await screen.findByText(/gagal dimuat ulang/i);
    expect(ui.reason.value).toBe(REASON);
    await user.click(ui.checkbox());
    expect(ui.submit().disabled).toBe(true);
    await user.click(ui.submit());
    expect(onDelete).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Muat Ulang Preview/i }));
    await screen.findByText(/Preview diperbarui/i);
    expect(onPreviewDelete).toHaveBeenCalledTimes(3);
    expect(onPreviewDelete).toHaveBeenLastCalledWith(202);
    expect(ui.checkbox().checked).toBe(false);
    expect(ui.reason.value).toBe(REASON);

    await user.click(ui.checkbox());
    await user.click(ui.submit());
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2));
    expect(onDelete.mock.calls[1][1].preview_token).toBe('tok_del_3');
  });
});
