// ponytail: bridge REST -> socket. Routes kirim ping, client yang refetch count.
let ioRef = null;

module.exports = {
  setIo(io) { ioRef = io; },
  toUser(userId, event, payload) {
    if (!ioRef || userId == null) return;
    for (const [, s] of ioRef.sockets.sockets) {
      if (s.userData && Number(s.userData.id) === Number(userId)) s.emit(event, payload);
    }
  }
};
