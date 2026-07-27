import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { liveMatrixConfig } from './support/env'
import {
  cleanStaleTestRooms,
  cleanTestRoom,
  removeOtherDevices,
  storedSessions,
  wipeAllDevices,
} from './support/matrix-api'
import { pace, retryMutatingRequest } from './support/retry'
import {
  addAccount,
  expectNoHorizontalOverflow,
  openRoomActions,
  sendMessage,
  signIn,
} from './support/ui'

const live = liveMatrixConfig()
const FAVICON_PATH = resolve(process.cwd(), 'public/favicon.png')

test.describe('live three-account Matrix journey', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!live.enabled, live.reason)

  test('creates and uses an encrypted room across accounts and devices', async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(8 * 60_000)
    const account1 = live.account1!
    const account2 = live.account2!
    const account3 = live.account3!
    const runId = `${Date.now()}-${testInfo.retry}-${testInfo.workerIndex}`
    const roomName = `${live.roomPrefix} ${runId}`
    const firstMessage = `encrypted hello from account one ${runId}`
    const secondMessage = `encrypted reply from account two ${runId}`
    const editedSecondMessage = `${secondMessage} edited`
    const thirdMessage = `encrypted message from remote account three ${runId}`
    const replyMessage = `reply to remote account three ${runId}`
    const editedReplyMessage = `${replyMessage} edited`
    const pollQuestion = `Which route should FoxChat test ${runId}?`
    const firstPollAnswer = `Encrypted messaging ${runId}`
    const secondPollAnswer = `Multi-account rooms ${runId}`
    const jsonBody =
      'sync payload ````JSON\n\n' +
      JSON.stringify({
        next_batch: '417575',
        rooms: {
          join: {
            '!foxchat-e2e:example.org': {
              unread_notifications: { notification_count: 1 },
              timeline: {
                prev_batch: '417572',
                events: [
                  {
                    content: { algorithm: 'm.megolm.v1.aes-sha2' },
                    type: 'm.room.encrypted',
                  },
                ],
              },
            },
          },
        },
      }) +
      '```'

    let context: BrowserContext | undefined
    let page: Page | undefined
    let remoteContext: BrowserContext | undefined
    let remotePage: Page | undefined
    let account2VerifiedContext: BrowserContext | undefined
    let roomId: string | undefined
    let sessions: Awaited<ReturnType<typeof storedSessions>> = []
    let retainedSessions: Awaited<ReturnType<typeof storedSessions>> = []
    let account1Id: string | undefined
    let account2Id: string | undefined
    let account3Id: string | undefined
    let journeyError: unknown
    let cleanupError: unknown

    try {
      await test.step('wipe every pre-existing device for all three accounts', async () => {
        for (const account of [account1, account2, account3]) await wipeAllDevices(browser, account)
      })
      context = await browser.newContext({
        baseURL,
        viewport: { width: 1440, height: 900 },
        permissions: ['clipboard-read', 'clipboard-write'],
      })
      page = await context.newPage()
      remoteContext = await browser.newContext({
        baseURL,
        viewport: { width: 1280, height: 800 },
      })
      remotePage = await remoteContext.newPage()

      await test.step('sign in two combined accounts and one remote account through the UI', async () => {
        await signIn(page!, account1)
        account1Id = (await storedSessions(page!)).at(-1)?.userId
        expect(account1Id).toMatch(/^@[^:]+:.+/)
        await addAccount(page!, account2)
        const signedIn = await storedSessions(page!)
        account2Id = signedIn.filter((session) => session.userId !== account1Id).at(-1)?.userId
        expect(account2Id).toMatch(/^@[^:]+:.+/)
        await signIn(remotePage!, account3)
        const remoteSessions = await storedSessions(remotePage!)
        account3Id = remoteSessions.at(-1)?.userId
        expect(account3Id).toMatch(/^@[^:]+:.+/)
        await cleanStaleTestRooms(live.roomPrefix, [...signedIn, ...remoteSessions])
        await page!.getByTestId('account-menu').click()
        await page!.getByText('Switch accounts', { exact: true }).click()
        const accounts = page!.getByRole('dialog', { name: 'Accounts' })
        await expect(accounts.getByText(account1Id!, { exact: true })).toBeVisible()
        await expect(accounts.getByText(account2Id!, { exact: true })).toBeVisible()
        await expect(accounts.getByText(account3Id!, { exact: true })).toHaveCount(0)
        await accounts.getByRole('button', { name: 'Close' }).click()
      })

      await test.step('create a private encrypted room', async () => {
        await openRoomActions(page!)
        await page!.getByText('Create a room', { exact: true }).click()
        const dialog = page!.getByRole('dialog', { name: 'Create a room' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Account').click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await dialog.getByLabel('Room name').fill(roomName)
        const encryption = dialog.getByRole('switch', {
          name: 'Encrypt this room',
        })
        if ((await encryption.getAttribute('aria-checked')) !== 'true') await encryption.click()
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/createRoom'),
          () => dialog.getByRole('button', { name: 'Create room' }).click(),
          { label: 'Matrix createRoom' },
        )
        await expect(
          page!.getByTestId('room-header').getByRole('heading', {
            name: roomName,
          }),
        ).toBeVisible({ timeout: 60_000 })
        await expect(page!.getByText('Encrypted with Megolm', { exact: true })).toBeVisible()
        roomId = new URL(page!.url()).searchParams.get('room') ?? undefined
        expect(roomId).toMatch(/^!/)
      })

      await test.step('join the second combined account and invite the remote account', async () => {
        await pace(page!)
        const detailsTitle = page!.getByText('Channel details', {
          exact: true,
        })
        if (!(await detailsTitle.isVisible()))
          await page!.getByRole('button', { name: 'Room information' }).click()
        await expect(detailsTitle).toBeVisible()
        await page!.getByText('Invite', { exact: true }).last().click()
        const invite = page!.getByRole('dialog', {
          name: 'Invite to room',
        })
        await invite.getByLabel('Matrix user ID').fill(account2Id!)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/invite'),
          () => invite.getByRole('button', { name: 'Send invitation' }).click(),
          { label: 'Matrix invite (account 2)' },
        )

        const invitation = page!.locator('.invitation').filter({
          hasText: roomName,
        })
        await expect(invitation).toBeVisible({ timeout: 60_000 })

        const anotherRoom = page!
          .locator('[data-testid="room-row"][data-room-type="room"]')
          .filter({ hasNotText: roomName })
          .first()
        await expect(anotherRoom).toBeVisible()
        await anotherRoom.click()
        await expect(page!.getByTestId('room-header').getByRole('heading')).not.toHaveText(roomName)
        await invitation.getByRole('button', { name: 'Accept' }).click()
        await expect(
          page!.getByTestId('room-header').getByRole('heading', {
            name: roomName,
          }),
        ).toBeVisible({ timeout: 60_000 })

        await pace(page!)
        await page!.getByText('Invite', { exact: true }).last().click()
        const secondInvite = page!.getByRole('dialog', {
          name: 'Invite to room',
        })
        await secondInvite.getByLabel('Matrix user ID').fill(account3Id!)
        await retryMutatingRequest(
          page!,
          (url) => url.pathname.endsWith('/invite'),
          () => secondInvite.getByRole('button', { name: 'Send invitation' }).click(),
          { label: 'Matrix invite (account 3)' },
        )
        const secondInvitation = remotePage!.locator('.invitation').filter({
          hasText: roomName,
        })
        await expect(secondInvitation).toBeVisible({ timeout: 60_000 })
        await secondInvitation.getByRole('button', { name: 'Accept' }).click()
        await expect(
          remotePage!.getByTestId('room-header').getByRole('heading', {
            name: roomName,
          }),
        ).toBeVisible({ timeout: 60_000 })
        await expect(
          page!.getByRole('button', {
            name: /Change sending account\. Currently/,
          }),
        ).toBeVisible({ timeout: 60_000 })
      })

      if (account2.recoveryKey) {
        await test.step('a recovery-key-verified account-two device joins and stays online to back up message keys', async () => {
          account2VerifiedContext = await browser.newContext({ baseURL })
          const verifiedPage = await account2VerifiedContext.newPage()
          await signIn(verifiedPage, account2)
          await verifiedPage
            .getByTestId('account-menu')
            .getByRole('button', { name: 'Open settings', exact: true })
            .click()
          const settings = verifiedPage.getByRole('dialog', {
            name: 'Settings',
          })
          await settings.getByRole('tab', { name: 'Security' }).click()
          await settings.getByRole('button', { name: 'Restore encrypted history' }).click()
          const restore = verifiedPage.getByRole('dialog', {
            name: 'Restore encrypted history',
          })
          await restore.getByRole('textbox').fill(account2.recoveryKey!)
          await restore.getByRole('button', { name: 'Restore keys' }).click()
          await expect(verifiedPage.getByText('Encrypted history recovery enabled')).toBeVisible({
            timeout: 90_000,
          })
          await verifiedPage.getByTestId('room-row').filter({ hasText: roomName }).click()
          await expect(
            verifiedPage.getByTestId('room-header').getByRole('heading', {
              name: roomName,
            }),
          ).toBeVisible({ timeout: 60_000 })
        })
      }

      await test.step('send encrypted messages as both joined accounts', async () => {
        await expect(
          page!.getByText('None of your joined accounts can send messages in this room', {
            exact: true,
          }),
        ).toHaveCount(0)
        const sendingAs = page!.getByRole('button', {
          name: /Change sending account\. Currently/,
        })
        await sendingAs.click()
        await page!.getByText(account1Id!, { exact: true }).last().click()
        await expect(sendingAs).toHaveAttribute(
          'aria-label',
          new RegExp(account1Id!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        )
        await sendMessage(page!, firstMessage)

        await sendingAs.click()
        await page!.getByText(account2Id!, { exact: true }).last().click()
        await expect(sendingAs).toHaveAttribute(
          'aria-label',
          new RegExp(account2Id!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        )
        await sendMessage(page!, secondMessage)
      })

      await test.step('receive an encrypted message from the separate third-account client', async () => {
        await sendMessage(remotePage!, thirdMessage)
        await expect(
          page!.locator('[data-event-id^="$"]').filter({ hasText: thirdMessage }).last(),
        ).toBeVisible({ timeout: 60_000 })
      })

      await test.step('edit, reply, and sync a reaction across clients', async () => {
        const secondEvent = page!
          .locator('[data-event-id^="$"]')
          .filter({ hasText: secondMessage })
          .last()
        const composer = page!.getByTestId('message-composer')
        await composer.click()
        await page!.keyboard.press('ArrowUp')
        await expect(composer).toHaveText(secondMessage)
        await composer.fill(editedSecondMessage)
        await page!.getByRole('button', { name: 'Send message' }).click()
        await expect(secondEvent).toContainText(editedSecondMessage, {
          timeout: 30_000,
        })
        await expect(secondEvent.getByText('(edited)', { exact: true })).toBeVisible({
          timeout: 30_000,
        })

        const thirdEvent = page!
          .locator('[data-event-id^="$"]')
          .filter({ hasText: thirdMessage })
          .last()
        await thirdEvent.hover()
        await thirdEvent.getByRole('button', { name: /Reply to / }).click()
        await expect(composer).toHaveAttribute('data-placeholder', /Reply to /)
        await composer.fill(replyMessage)
        await page!.getByRole('button', { name: 'Send message' }).click()
        await expect(page!.getByTestId('room-row').filter({ hasText: roomName })).toContainText(
          replyMessage,
          { timeout: 30_000 },
        )
        await expect(
          remotePage!.locator('[data-event-id^="$"]').filter({ hasText: replyMessage }).last(),
        ).toBeVisible({ timeout: 60_000 })

        await thirdEvent.hover()
        await thirdEvent.getByRole('button', { name: 'React with 👍' }).click()
        await expect(thirdEvent.getByRole('button', { name: /👍\s*1/ })).toBeVisible({
          timeout: 30_000,
        })
        const remoteThirdEvent = remotePage!
          .locator('[data-event-id^="$"]')
          .filter({ hasText: thirdMessage })
          .last()
        await expect(remoteThirdEvent.getByRole('button', { name: /👍\s*1/ })).toBeVisible({
          timeout: 60_000,
        })
      })

      await test.step('editing a reply shows the reply banner and keeps the reply relation', async () => {
        const composer = page!.getByTestId('message-composer')
        const replyEvent = page!
          .locator('[data-event-id^="$"]')
          .filter({ hasText: replyMessage })
          .last()
        await replyEvent.click({ button: 'right' })
        await page!.getByRole('menuitem', { name: 'Edit' }).click()
        await expect(composer).toHaveText(replyMessage)

        await expect(page!.getByText('Editing message', { exact: true })).toBeVisible()
        const replyBanner = page!.getByText(/^Replying to /).locator('..')
        await expect(replyBanner).toBeVisible()
        await expect(replyBanner).toContainText(thirdMessage)
        await expect(composer).toHaveAttribute('data-placeholder', /Edit reply to /)

        await composer.fill(editedReplyMessage)
        await page!.getByRole('button', { name: 'Send message' }).click()
        await expect(replyEvent).toContainText(editedReplyMessage, {
          timeout: 30_000,
        })
        await expect(replyEvent.getByText('(edited)', { exact: true })).toBeVisible({
          timeout: 30_000,
        })

        const replyQuote = replyEvent.locator('button[title="Jump to replied message"]')
        await expect(replyQuote).toBeVisible({ timeout: 30_000 })
        await expect(replyQuote).toContainText(thirdMessage)
      })

      await test.step('dropping an image directly on the composer attaches it instead of inlining it into the text', async () => {
        const composer = page!.getByTestId('message-composer')
        const bytes = [...readFileSync(FAVICON_PATH)]
        const dataTransfer = await page!.evaluateHandle(
          ({ bytes, name }) => {
            const dt = new DataTransfer()
            dt.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }))
            return dt
          },
          { bytes, name: 'dropped.png' },
        )
        await composer.dispatchEvent('drop', { dataTransfer })

        await expect(page!.getByRole('button', { name: 'Remove image' })).toBeVisible({
          timeout: 10_000,
        })
        await expect(composer).toHaveText('')
        await expect(composer.locator('img')).toHaveCount(0)
        await page!.getByRole('button', { name: 'Remove image' }).click()
      })

      await test.step('create, vote on, and end a poll across clients', async () => {
        await pace(page!)
        await page!.getByRole('button', { name: 'paper-clip', exact: true }).click()
        await page!.getByText('Create poll', { exact: true }).last().click()
        const pollDialog = page!.getByRole('dialog', {
          name: 'Create a poll',
        })
        await pollDialog.getByPlaceholder('Ask a question').fill(pollQuestion)
        await pollDialog.getByPlaceholder('Option 1').fill(firstPollAnswer)
        await pollDialog.getByPlaceholder('Option 2').fill(secondPollAnswer)
        await pollDialog.getByRole('button', { name: 'Create poll', exact: true }).click()

        const localPoll = page!
          .locator('[data-event-id^="$"]')
          .filter({ hasText: pollQuestion })
          .last()
        await expect(localPoll).toBeVisible({ timeout: 30_000 })
        const remotePoll = remotePage!
          .locator('[data-event-id^="$"]')
          .filter({ hasText: pollQuestion })
          .last()
        await expect(remotePoll).toBeVisible({ timeout: 60_000 })
        await localPoll.getByRole('button', { name: firstPollAnswer }).click()
        await expect(localPoll.getByText('1 · 100%', { exact: true })).toBeVisible({
          timeout: 30_000,
        })
        await remotePoll.getByRole('button', { name: secondPollAnswer }).click()
        await expect(localPoll.getByText('1 · 50%', { exact: true }).first()).toBeVisible({
          timeout: 60_000,
        })
        await localPoll.getByRole('button', { name: 'End poll' }).click()
        await expect(localPoll.getByText('Final results', { exact: true })).toBeVisible({
          timeout: 30_000,
        })
        await expect(remotePoll.getByText('Final results', { exact: true })).toBeVisible({
          timeout: 60_000,
        })
      })

      await test.step('replace malformed fenced JSON with the interactive viewer', async () => {
        await page!.getByTestId('message-composer').fill(jsonBody)
        await page!.getByRole('button', { name: 'Send message' }).click()
        const acknowledgedMessage = page!
          .locator('[data-event-id^="$"]')
          .filter({ hasText: 'sync payload' })
          .last()
        await expect(acknowledgedMessage).toBeVisible({ timeout: 30_000 })
        const viewer = acknowledgedMessage.getByTestId('json-viewer')
        await expect(viewer).toBeVisible({ timeout: 30_000 })
        await expect(viewer).toContainText('"next_batch":')
        await expect(viewer).toContainText('m.megolm.v1.aes-sha2')
        await expect(page!.getByTestId('timeline')).not.toContainText('````JSON')

        await viewer.getByRole('button', { name: 'View JSON fullscreen' }).click()
        const fullscreen = page!.getByRole('dialog', {
          name: 'JSON JSON preview',
        })
        await expect(fullscreen).toBeVisible()

        await fullscreen
          .getByRole('button', { name: 'Exit JSON fullscreen' })
          .dispatchEvent('click')
        await expect(fullscreen).toBeHidden()
      })

      await test.step('browser Back closes pushed overlays without losing the room', async () => {
        await page!.getByRole('button', { name: 'Search this room' }).click()
        await expect(page!.getByRole('dialog', { name: 'Search this room' })).toBeVisible()
        expect(new URL(page!.url()).searchParams.get('search')).toBe('room')
        await page!.goBack()
        await expect(page!.getByRole('dialog', { name: 'Search this room' })).toBeHidden()
        expect(new URL(page!.url()).searchParams.has('search')).toBe(false)

        await page!.getByRole('button', { name: 'Threads' }).click()
        await expect(page!.getByText('Threads', { exact: true }).last()).toBeVisible()
        expect(new URL(page!.url()).searchParams.get('thread')).toBe('list')
        await page!.goBack()
        await expect(page!.getByRole('button', { name: 'Close threads' })).toBeHidden()
        expect(new URL(page!.url()).searchParams.has('thread')).toBe(false)
        expect(new URL(page!.url()).searchParams.get('room')).toBe(roomId)
      })

      await test.step('header clicks, settings, theme, and mobile drawer behave', async () => {
        const detailsTitle = page!.getByText('Channel details', { exact: true })
        await expect(detailsTitle).toBeVisible()
        await page!.getByTestId('room-header').click({ position: { x: 180, y: 20 } })
        await expect(detailsTitle).toBeHidden()
        await page!.getByTestId('room-header').click({ position: { x: 180, y: 20 } })
        await expect(detailsTitle).toBeVisible()

        const accountMenu = page!.getByTestId('account-menu')
        await accountMenu.getByRole('button', { name: 'Enable dark mode', exact: true }).click()
        await expect(
          accountMenu.getByRole('button', {
            name: 'Enable light mode',
            exact: true,
          }),
        ).toBeVisible()
        await accountMenu.getByRole('button', { name: 'Open settings', exact: true }).click()
        await expect(page!.getByRole('dialog', { name: 'Settings' })).toBeVisible()
        expect(new URL(page!.url()).searchParams.get('settings')).toBe('true')
        await page!.goBack()
        await expect(page!.getByRole('dialog', { name: 'Settings' })).toBeHidden()

        await page!.setViewportSize({ width: 412, height: 915 })
        await expectNoHorizontalOverflow(page!)
        await page!.getByRole('button', { name: 'Open room list' }).click()
        await expect(page!.getByTestId('room-sidebar').last()).toBeVisible()
        expect(new URL(page!.url()).searchParams.get('drawerOpen')).toBe('true')
        await page!
          .locator('.ant-drawer-mask')
          .last()
          .click({ position: { x: 400, y: 450 } })
        await expect(page!.getByTestId('room-sidebar').last()).toBeHidden()
        expect(new URL(page!.url()).searchParams.has('drawerOpen')).toBe(false)
      })

      sessions = await storedSessions(page)
      sessions.push(...(await storedSessions(remotePage)))
      retainedSessions = [...sessions]

      if (account2.recoveryKey) {
        await test.step('restore encrypted history on a fresh account-two device', async () => {
          const recoveryContext = await browser.newContext({
            baseURL,
            viewport: { width: 1440, height: 900 },
          })
          const recoveryPage = await recoveryContext.newPage()
          try {
            await signIn(recoveryPage, account2)
            sessions.push(...(await storedSessions(recoveryPage)))
            await recoveryPage
              .getByTestId('account-menu')
              .getByRole('button', { name: 'Open settings', exact: true })
              .click()
            const settings = recoveryPage.getByRole('dialog', {
              name: 'Settings',
            })
            await settings.getByRole('tab', { name: 'Security' }).click()
            await settings.getByRole('button', { name: 'Restore encrypted history' }).click()
            const restore = recoveryPage.getByRole('dialog', {
              name: 'Restore encrypted history',
            })
            await restore.getByRole('textbox').fill(account2.recoveryKey!)
            await restore.getByRole('button', { name: 'Restore keys' }).click()
            await expect(recoveryPage.getByText('Encrypted history recovery enabled')).toBeVisible({
              timeout: 90_000,
            })
            await recoveryPage.getByTestId('room-row').filter({ hasText: roomName }).click()
            await expect(
              recoveryPage.getByTestId('timeline').getByText(firstMessage, {
                exact: true,
              }),
            ).toBeVisible({ timeout: 90_000 })
          } finally {
            await recoveryContext.close()
          }
        })
      } else {
        testInfo.annotations.push({
          type: 'recovery',
          description: 'Skipped fresh-device recovery because account 2 has no recovery key',
        })
      }
    } catch (error) {
      journeyError = error
    } finally {
      try {
        if (page && !page.isClosed()) {
          const latest = await storedSessions(page).catch(() => [])
          sessions.push(...latest)
        }
        if (remotePage && !remotePage.isClosed()) {
          const latest = await storedSessions(remotePage).catch(() => [])
          sessions.push(...latest)
        }
        const uniqueSessions = [
          ...new Map(
            sessions.map((session) => [
              `${session.baseUrl}\0${session.userId}\0${session.deviceId}`,
              session,
            ]),
          ).values(),
        ]
        const currentSessions = [account1Id, account2Id, account3Id].flatMap((userId) => {
          const current =
            retainedSessions.filter((session) => session.userId === userId).at(-1) ??
            uniqueSessions.filter((session) => session.userId === userId).at(-1)
          return current ? [current] : []
        })
        if (roomName.startsWith(live.roomPrefix)) await cleanTestRoom(roomId, currentSessions)
        await test.step('sign out every non-current device on all accounts', async () => {
          for (const [account, userId] of [
            [account1, account1Id],
            [account2, account2Id],
            [account3, account3Id],
          ] as const) {
            const current = currentSessions.filter((session) => session.userId === userId).at(-1)
            if (current) await removeOtherDevices(browser, current, account.password)
          }
        })
      } catch (error) {
        cleanupError = error
      } finally {
        await context?.close()
        await remoteContext?.close()
        await account2VerifiedContext?.close()
      }
    }
    if (journeyError) throw journeyError
    if (cleanupError) throw cleanupError
  })
})
