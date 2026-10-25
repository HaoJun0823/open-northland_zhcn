import { MAX_NICK_LENGTH } from '@open-northland/net-protocol';
import { quietTextField } from '../../../hud/dom/parts/text-field.js';
import { messages } from '../../../i18n/index.js';
import { patchStoredSettings, readStoredSettings } from '../../../view/settings/store.js';
import { node } from '../dom.js';
import { relayAddress } from './model.js';
import { button, field } from './parts.js';
import { regionPicker } from './server/picker.js';
import { pingRelay, type RelayPing } from './server/ping.js';
import { DEFAULT_RELAY_REGION, relayRegionAt } from './server/regions.js';

export function connectionForm(
  initialAddress: string | null,
  onDisconnect: () => void,
  ping: RelayPing = pingRelay,
) {
  const copy = messages().network;
  const address = node('input');
  address.type = 'text';
  quietTextField(address);
  const storedCustom = readStoredSettings().netCustomRelayUrl;
  address.value = initialAddress ?? storedCustom ?? DEFAULT_RELAY_REGION.url;
  /** Entry follows the fastest region until the player names a server: a click, an edit, a URL. */
  let followFastest = initialAddress === null && storedCustom === null;
  const rememberAddress = (): void => {
    if (relayAddress(address.value) === null) return;
    patchStoredSettings({
      netCustomRelayUrl: relayRegionAt(address.value) === undefined ? address.value.trim() : null,
    });
  };
  const serverName = node('p', 'network-menu__eyebrow');
  const describeServer = (): void => {
    serverName.textContent = relayRegionAt(address.value) ? copy.officialServer : copy.customServer;
    picker.select(relayRegionAt(address.value)?.id);
  };
  const useRegion = (url: string): void => {
    address.value = url;
    describeServer();
    rememberAddress();
  };
  const picker = regionPicker(
    ping,
    (region) => {
      followFastest = false;
      useRegion(region.url);
    },
    (fastest) => {
      if (followFastest && fastest !== undefined && !address.disabled) address.value = fastest.url;
      describeServer();
    },
  );
  address.addEventListener('change', rememberAddress);
  address.addEventListener('input', () => {
    followFastest = false;
    describeServer();
  });
  const nick = quietTextField(node('input'));
  nick.value = readStoredSettings().netNick ?? '';
  nick.maxLength = MAX_NICK_LENGTH;
  nick.required = true;
  nick.setAttribute('autocomplete', 'nickname');
  const form = node('form', 'network-menu__connection');
  describeServer();
  const intro = node('div', 'network-menu__intro');
  intro.append(node('h2', '', copy.welcome), serverName);
  const advanced = node('details', 'network-menu__advanced');
  advanced.open = relayRegionAt(address.value) === undefined;
  const resetServer = button(copy.resetServer, () =>
    useRegion((picker.fastest() ?? DEFAULT_RELAY_REGION).url),
  );
  advanced.append(
    node('summary', '', copy.advanced),
    node('p', 'network-menu__muted', copy.serverHint),
    field(copy.server, address),
    resetServer,
  );
  const account = node('div', 'network-menu__account');
  const accountName = node('strong');
  const connect = node('button', 'main-menu__primary', copy.connect);
  connect.type = 'submit';
  const disconnect = button(copy.disconnect, onDisconnect);
  // Not a <label>: a label around the region buttons would click the first one.
  const region = node('div', 'network-menu__field');
  region.append(node('span', '', copy.serverRegion), picker.element);
  form.append(intro, region, field(copy.nick, nick), connect, advanced);
  account.append(accountName, disconnect);
  return {
    form,
    account,
    accountName,
    address,
    nick,
    advanced,
    resetServer,
    connect,
    disconnect,
    rememberAddress,
    lockServer(locked: boolean): void {
      address.disabled = locked;
      resetServer.disabled = locked;
      picker.setDisabled(locked);
    },
    dispose: picker.dispose,
  };
}
