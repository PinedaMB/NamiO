const repository = 'https://github.com/PinedaMB/NamiO';

/** Actualiza solo con publicaciones y archivos del repositorio oficial. */
export async function updateRelease(document, fetchRelease = fetch) {
  try {
    const response = await fetchRelease('https://api.github.com/repos/PinedaMB/NamiO/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return;
    const release = await response.json();
    if (release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) return;
    const version = `v${release.tag_name.replace(/^v/, '')}`;
    document.querySelectorAll('[data-release-version]').forEach(element => { element.textContent = version; });
    document.querySelector('[data-release-note]').textContent = `Última versión publicada: ${version}. Consulta las notas de la versión en GitHub.`;
    for (const format of ['AppImage', 'deb', 'exe']) {
      const asset = release.assets.find(asset =>
        typeof asset.name === 'string' && asset.name.toLowerCase().endsWith(`.${format.toLowerCase()}`) &&
        !/arm64|aarch64|ia32/i.test(asset.name) && asset.state === 'uploaded' &&
        typeof asset.browser_download_url === 'string' &&
        asset.browser_download_url.startsWith(`${repository}/releases/download/${encodeURIComponent(release.tag_name)}/`));
      if (!asset) continue;
      const link = document.querySelector(`[data-release-download="${format}"]`);
      link.href = asset.browser_download_url;
      link.querySelector('[data-download-label]').textContent = `Descargar ${format === 'exe' ? 'para Windows' : format === 'deb' ? '.deb' : format}`;
      if (format === 'exe') document.querySelector('[data-windows-status]').textContent = 'Disponible (.exe)';
    }
  } catch {
    // Sin red o con límite de GitHub, los enlaces estáticos a Releases siguen funcionando.
  }
}
