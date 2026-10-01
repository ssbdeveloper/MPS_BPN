import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import {
  REASON, staleError, applyPreview, openApplyDialog,
} from './staleTestHelpers';

describe('PREVIEW_STALE — deteksi via err.code (APPLY)', () => {
  it('sanity: pesan error nyata tidak mengandung string PREVIEW_STALE', () => {
    expect(staleError().message.includes('PREVIEW_STALE')).toBe(false);
    expect(staleError().code).toBe('PREVIEW_STALE');
  });

  it('refresh berhasil: alasan dipertahankan, konfirmasi ulang wajib, retry memakai token baru', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn()
      .mockResolvedValueOnce(applyPreview('tok_apply_1'))
      .mockResolvedValueOnce(applyPreview('tok_apply_2'));
    const onApply = vi.fn().mockRejectedValueOnce(staleError()).mockResolvedValueOnce({ ok: true });
    const ui = await openApplyDialog(user, { onPreviewOverride: onPreview, onApplyOverride: onApply });

    await user.type(ui.reason, REASON);
    await user.click(ui.checkbox());
    await user.click(ui.submit());

    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(2));
    expect(onApply.mock.calls[0][0].preview_token).toBe('tok_apply_1');
    await screen.findByText(/Preview diperbarui, centang konfirmasi ulang/i);
    expect(ui.reason.value).toBe(REASON);
    expect(ui.checkbox().checked).toBe(false);
    expect(ui.submit().disabled).toBe(true);

    await user.click(ui.checkbox());
    expect(ui.submit().disabled).toBe(false);
    await user.click(ui.submit());

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    expect(onApply.mock.calls[1][0]).toMatchObject({ preview_token: 'tok_apply_2', reason: REASON, confirm_today_impact: true });
    await waitFor(() => expect(screen.queryByText('Konfirmasi Perubahan Hari Ini')).toBeNull());
  });

  it('refresh gagal: submit tetap terkunci, tidak ada submit ulang dengan token lama; refresh manual lalu retry token baru', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn()
      .mockResolvedValueOnce(applyPreview('tok_apply_1'))
      .mockRejectedValueOnce(Object.assign(new Error('Koneksi database terputus'), { status: 503 }))
      .mockResolvedValueOnce(applyPreview('tok_apply_3'));
    const onApply = vi.fn().mockRejectedValueOnce(staleError()).mockResolvedValueOnce({ ok: true });
    const ui = await openApplyDialog(user, { onPreviewOverride: onPreview, onApplyOverride: onApply });

    await user.type(ui.reason, REASON);
    await user.click(ui.checkbox());
    await user.click(ui.submit());

    await screen.findByText(/gagal dimuat ulang/i);
    expect(ui.reason.value).toBe(REASON);
    // Centang ulang pun tidak boleh membuka submit selama preview masih yang lama.
    await user.click(ui.checkbox());
    expect(ui.submit().disabled).toBe(true);
    await user.click(ui.submit());
    expect(onApply).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Muat Ulang Preview/i }));
    await screen.findByText(/Preview diperbarui/i);
    expect(onPreview).toHaveBeenCalledTimes(3);
    expect(ui.checkbox().checked).toBe(false);
    expect(ui.reason.value).toBe(REASON);

    await user.click(ui.checkbox());
    await user.click(ui.submit());
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    expect(onApply.mock.calls[1][0].preview_token).toBe('tok_apply_3');
  });

  it('error non-stale tidak memicu refresh preview dan mempertahankan alasan', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn().mockResolvedValue(applyPreview('tok_apply_1'));
    const onApply = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Server error'), { status: 500 }))
      .mockResolvedValueOnce({ ok: true });
    const ui = await openApplyDialog(user, { onPreviewOverride: onPreview, onApplyOverride: onApply });
    await user.type(ui.reason, REASON);
    await user.click(ui.checkbox());
    await user.click(ui.submit());
    await screen.findByText('Server error');
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(ui.reason.value).toBe(REASON);
    await user.click(ui.submit());
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    expect(onApply.mock.calls[1][0].preview_token).toBe('tok_apply_1');
  });
});
