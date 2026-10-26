// A decode child that answers one job and is then killed while idle, as by the host's OOM killer.
process.on('message', () => {
  process.send({ kind: 'refused', reason: 'invalid' }, () => process.kill(process.pid, 'SIGKILL'));
});
