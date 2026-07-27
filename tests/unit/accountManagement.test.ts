import { describe, expect, it } from 'vitest'
import {
  accountManagementActionUrl,
  deviceDeletionAccountManagementUrl,
} from '../../src/lib/accountManagement'

describe('OAuth account-management URLs', () => {
  it('builds a device-delete action with an encoded device ID', () => {
    const url = new URL(
      deviceDeletionAccountManagementUrl('https://account.example.org/manage', 'DEVICE / ONE'),
    )

    expect(url.origin + url.pathname).toBe('https://account.example.org/manage')
    expect(url.searchParams.get('action')).toBe('org.matrix.device_delete')
    expect(url.searchParams.get('device_id')).toBe('DEVICE / ONE')
  })

  it('preserves provider parameters while overriding action parameters', () => {
    const url = new URL(
      accountManagementActionUrl(
        'https://account.example.org/manage?tenant=fox&action=old',
        'org.matrix.devices_list',
      ),
    )

    expect(url.searchParams.get('tenant')).toBe('fox')
    expect(url.searchParams.get('action')).toBe('org.matrix.devices_list')
  })

  it('rejects an invalid account-management URI', () => {
    expect(() => deviceDeletionAccountManagementUrl('not a URL', 'DEVICE')).toThrow()
  })
})
