export const DEVICE_DELETE_ACTION = 'org.matrix.device_delete'

export const accountManagementActionUrl = (
  accountManagementUri: string,
  action: string,
  parameters: Record<string, string> = {},
) => {
  const url = new URL(accountManagementUri)
  url.searchParams.set('action', action)
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
  return url.toString()
}

export const deviceDeletionAccountManagementUrl = (
  accountManagementUri: string,
  deviceId: string,
) =>
  accountManagementActionUrl(accountManagementUri, DEVICE_DELETE_ACTION, {
    device_id: deviceId,
  })
