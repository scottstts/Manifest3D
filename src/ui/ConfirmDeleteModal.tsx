import type { AssetLibraryAsset } from '../engine/persistence/assetLibraryTypes'

type ConfirmDeleteModalProps = {
  asset: AssetLibraryAsset | null
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDeleteModal({
  asset,
  onCancel,
  onConfirm,
}: ConfirmDeleteModalProps) {
  if (!asset) {
    return null
  }

  return (
    <div
      aria-labelledby="delete-asset-title"
      aria-modal="true"
      className="confirm-modal"
      role="dialog"
    >
      <div className="confirm-modal__surface">
        <h2 id="delete-asset-title">Delete asset?</h2>
        <p>
          This removes {asset.name} and all {asset.versions.length} saved
          versions from history.
        </p>
        <div className="confirm-modal__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="confirm-modal__danger"
            type="button"
            onClick={onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
