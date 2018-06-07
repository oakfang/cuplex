class Channel {
  constructor(parent) {
    this._queue = [];
    this._parent = parent;
    this._children = new Set();
    this._toNotify = [];
  }

  get childCount() {
    return this._children.size;
  }

  get hasChildren() {
    return !!this.childCount;
  }

  detach() {
    if (this._parent) {
      this._parent._children.delete(this);
      if (!this._parent.hasChildren) {
        this._parent._notify();
      }
      this._parent = null;
    }
  }

  _spawn() {
    const channel = new Channel(this);
    this._children.add(channel);
    return channel;
  }

  _notify() {
    this._toNotify.slice().forEach(() => {
      const listener = this._toNotify.shift();
      listener();
    });
  }

  _push(pkg) {
    this._queue.push(pkg);
    this._notify();
  }

  merge(channel) {
    for (const child of channel._children) {
      const currentParent = child._parent;
      child._parent = this;
      this._children.add(child);
      currentParent._queue.forEach(pkg => this._push(pkg));
    }
    return this;
  }

  _getPkg(data, ok) {
    const pkg = {
      data
    };
    pkg.taken = new Promise((resolve, reject) => {
      pkg.accept = ok ? resolve : reject;
    });
    return pkg;
  }

  _dispatch(data, ok) {
    if (this._parent) {
      const pkg = this._getPkg(data, ok);
      this._parent._push(pkg);
      return pkg.taken;
    }
    return Promise.all(
      Array.from(this._children).map(child => {
        const pkg = this._getPkg(data, ok);
        child._push(pkg, ok);
        return pkg.taken;
      })
    );
  }

  send(data) {
    return this._dispatch(data, true);
  }

  sendErr(data) {
    return this._dispatch(data, false);
  }

  _recv() {
    const pkg = this._queue.shift();
    pkg.accept();
    return pkg.data;
  }

  recv() {
    if (this._queue.length) {
      return Promise.resolve(this._recv());
    }
    if (this._children && !this.hasChildren) {
      return Promise.reject(
        new Error("Cannot recieve on a channel with no children")
      );
    }
    return new Promise((resolve, reject) => {
      const listener = () => {
        if (this._queue.length) {
          return resolve(this._recv());
        }
        if (!this._children || this.hasChildren) {
          return this._toNotify.push(listener);
        }
        return reject(
          new Error("Cannot recieve on a channel with no children")
        );
      };
      this._toNotify.push(listener);
    });
  }

  join() {
    if (!this.hasChildren) {
      return Promise.resolve();
    }
    const listener = resolve => () => {
      if (this.hasChildren) {
        return this._toNotify.push(listener(resolve));
      }
      return resolve();
    };
    return new Promise(resolve => this._toNotify.push(listener(resolve)));
  }
}

function generateDuplex() {
  const rx = new Channel();
  const tx = rx._spawn();
  return { rx, tx };
}

function pool(fns) {
  if (!fns.length) throw new Error("Pool must have at least one worker");
  fns = fns.slice();
  const master = cuplex(fns.shift());
  return fns.reduce((master, worker) => master.merge(cuplex(worker)), master);
}

function mutex(count) {
  if (count < 1) throw new Error("mutex count must be >= 1");
  const { rx, tx } = generateDuplex();
  for (let i = 0; i < count; i++) {
    tx.send();
  }

  return {
    async acquire() {
      await rx.recv();
      return () => tx.send();
    }
  };
}

function lock() {
  return mutex(1);
}

const txAsPromise = (fn, tx) =>
  Promise.resolve(tx)
    .then(fn)
    .catch(err => tx.sendErr(err))
    .then(() => tx.detach());

function cuplex(fn) {
  const { rx, tx } = generateDuplex();
  txAsPromise(fn, tx);
  return rx;
}

Object.assign(cuplex, { generateDuplex, pool, mutex, lock });

module.exports = cuplex;
