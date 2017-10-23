/// Deps
const wasm = require('../iota-bindings/emscripten/src/main.rs')
wasm.initialize({ noExitRuntime: true }).then(IOTA => {
  require('babel-polyfill')
  const crypto = require('crypto')
  const Crypto = require('iota.crypto.js')
  const Encryption = require('./encryption')
  const pify = require('pify')
  // Setup Provider
  var iota = {}

  const init = (externalIOTA = {}, seed = keyGen(81), security = 2) => {
    // Set IOTA object
    iota = externalIOTA
    // Setup Personal Channel
    var channelSeed = Encryption.hash(Crypto.converter.trits(seed.slice()))
    var channelKey = Crypto.converter.trytes(channelSeed.slice())
    var channel = {
      side_key: null,
      next_root: null,
      security: security,
      start: 0,
      count: 1,
      next_count: 1,
      index: 0
    }
    // Setup Subs
    const subscribed = []
    return {
      subscribed: subscribed,
      channel: channel,
      seed: seed
    }
  }

  const subscribe = (state, channelRoot, channelKey = null) => {
    state.subscribed[channelRoot] = {
      channelKey: channelKey,
      timeout: 5000,
      root: channelRoot,
      next_root: null,
      active: true
    }
    return state
  }

  const create = (state, message) => {
    var channel = state.channel
    let mam = createMessage(state.seed, message, null, channel)
    // If the tree is exhausted.
    if (channel.index == channel.count - 1) {
      // change start to begining of next tree.
      channel.start = channel.next_count + channel.start
      // Reset index.
      channel.index = 0
    } else {
      //Else step the tree.
      channel.index++
    }
    channel.next_root = mam.next_root
    state.channel = channel
    return {
      state,
      payload: mam.payload,
      root: mam.root
    }
  }

  // Current root
  const getRoot = state => {
    return getMamRoot(state.seed, state.channel)
  }
  const decode = (payload, side_key, root) => {
    let mam = decodeMessage(payload, side_key, root)
    return mam
  }

  const fetch = async address => {
    let consumedAll = false
    let messages = []
    let nextRoot = address

    let transactionCount = 0
    let messageCount = 0

    while (!consumedAll) {
      console.log('Looking up data at: ', nextRoot)
      let hashes = await pify(iota.api.findTransactions.bind(iota.api))({
        addresses: [nextRoot]
      })

      if (hashes.length == 0) {
        consumedAll = true
        break
      }

      transactionCount += hashes.length
      messageCount++

      let messagesGen = await txHashesToMessages(hashes)
      for (let message of messagesGen) {
        try {
          var payload = message
          let unmasked = decode(payload, null, nextRoot)
          messages.push(unmasked.payload)
          nextRoot = unmasked.next_root
        } catch (e) {
          console.error('failed to parse: ', e)
        }
      }
    }

    console.log('Total transaction count: ', transactionCount)

    return {
      nextRoot: nextRoot,
      messages: messages
    }
  }

  const listen = (channel, callback) => {
    var root = channel.root
    return setTimeout(async () => {
      console.log('Fetching')
      var resp = await fetch(root)
      root = resp.nextRoot
      callback(resp.messages)
    }, channel.timeout)
  }

  // Sync requests
  const txHashesToMessages = async hashes => {
    let bundles = {}

    let processTx = txo => {
      let bundle = txo.bundle
      let msg = txo.signatureMessageFragment
      let idx = txo.currentIndex
      let maxIdx = txo.lastIndex

      if (bundle in bundles) {
        bundles[bundle].push([idx, msg])
      } else {
        bundles[bundle] = [[idx, msg]]
      }

      if (bundles[bundle].length == maxIdx + 1) {
        let l = bundles[bundle]
        delete bundles[bundle]
        return l.sort((a, b) => b[0] < a[0]).reduce((acc, n) => acc + n[1], '')
      }
    }

    let objs = await pify(iota.api.getTransactionsObjects.bind(iota.api))(
      hashes
    )
    return objs
      .map(result => processTx(result))
      .filter(item => item !== undefined)
  }

  const attach = async (trytes, root) => {
    var transfers = [
      {
        address: root,
        value: 0,
        message: trytes
      }
    ]
    // if (isClient) curl.overrideAttachToTangle(iota)
    try {
      let objs = await pify(iota.api.sendTransfer.bind(iota.api))(
        keyGen(81),
        5,
        9,
        transfers
      )
      console.log('Message attached')
      return objs
    } catch (e) {
      return console.error('failed to attach message:', '\n', e)
    }
  }

  const isClient =
    typeof window !== 'undefined' &&
    window.document &&
    window.document.createElement

  const keyGen = length => {
    var charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ9'
    var values = crypto.randomBytes(length)
    var result = new Array(length)
    for (var i = 0; i < length; i++) {
      result[i] = charset[values[i] % charset.length]
    }
    return result.join('')
  }
  //////////////////////////////////////////////////////////////////
  /* ======= CTrits bindings ======= */
  const TritEncoding = {
    BYTE: 1,
    TRIT: 2,
    TRYTE: 3
  }

  /* ======= Rust bindings ======= */

  const iota_ctrits_drop = IOTA.cwrap('iota_ctrits_drop', '', ['number'])
  const iota_ctrits_convert = IOTA.cwrap('iota_ctrits_convert', 'number', [
    'number',
    'number'
  ])
  const iota_ctrits_ctrits_from_trytes = IOTA.cwrap(
    'iota_ctrits_ctrits_from_trytes',
    'number',
    ['string', 'number']
  )
  const iota_ctrits_ctrits_from_bytes = IOTA.cwrap(
    'iota_ctrits_ctrits_from_bytes',
    'number',
    ['number', 'number']
  )
  const iota_ctrits_ctrits_from_trits = IOTA.cwrap(
    'iota_ctrits_ctrits_from_trits',
    'number',
    ['number', 'number']
  )

  // For accessing the struct members
  const iota_ctrits_ctrits_encoding = IOTA.cwrap(
    'iota_ctrits_ctrits_encoding',
    'number',
    ['number']
  )
  const iota_ctrits_ctrits_length = IOTA.cwrap(
    'iota_ctrits_ctrits_length',
    'number',
    ['number']
  )
  const iota_ctrits_ctrits_data = IOTA.cwrap(
    'iota_ctrits_ctrits_data',
    'number',
    ['number']
  )
  const iota_ctrits_ctrits_byte_length = IOTA.cwrap(
    'iota_ctrits_ctrits_byte_length',
    'number',
    ['number']
  )

  // (seed, message, key, root, siblings, next_root, start, index, security) -> encoded_message
  const iota_mam_create = IOTA.cwrap('iota_mam_create', 'number', [
    'number',
    'number',
    'number',
    'number',
    'number',
    'number',
    'number',
    'number',
    'number'
  ])
  // (encoded_message, key, root, index) -> message
  const iota_mam_parse = IOTA.cwrap('iota_mam_parse', 'number', [
    'number',
    'number',
    'number',
    'number'
  ])

  // (seed, index, count, securit) -> MerkleTree instance
  const iota_merkle_create = IOTA.cwrap('iota_merkle_create', 'number', [
    'number',
    'number',
    'number',
    'number'
  ])
  // (MerkleTree instance) -> ()
  const iota_merkle_drop = IOTA.cwrap('iota_merkle_drop', '', ['number'])
  // (MerkleTree instance) -> (siblings as number)
  const iota_merkle_siblings = IOTA.cwrap('iota_merkle_siblings', 'number', [
    'number'
  ])
  // (MerkleTree instance, index) -> (MerkleBranch instance)
  const iota_merkle_branch = IOTA.cwrap('iota_merkle_branch', 'number', [
    'number',
    'number'
  ])
  // (MerkleBranch instance) -> ()
  const iota_merkle_branch_drop = IOTA.cwrap('iota_merkle_branch_drop', '', [
    'number'
  ])
  // (MerkleBranch instance) -> (number)
  const iota_merkle_branch_len = IOTA.cwrap('iota_merkle_branch_len', '', [
    'number'
  ])
  // (address, siblings, index) -> (root as number)
  const iota_merkle_root = IOTA.cwrap('iota_merkle_root', 'number', [
    'number',
    'number',
    'number'
  ])
  // (MerkleTree instance) -> root hash
  const iota_merkle_slice = IOTA.cwrap('iota_merkle_slice', 'number', [
    'number'
  ])

  const string_to_ctrits_trits = str => {
    let strin = iota_ctrits_ctrits_from_trytes(str, str.length)
    let out = iota_ctrits_convert(strin, TritEncoding.TRIT)
    iota_ctrits_drop(strin)
    return out
  }

  const ctrits_trits_to_string = ctrits => {
    let str_trits = iota_ctrits_convert(ctrits, TritEncoding.TRYTE)
    let ptr = iota_ctrits_ctrits_data(str_trits)
    let len = iota_ctrits_ctrits_length(str_trits)
    let out = IOTA.Pointer_stringify(ptr, len)
    iota_ctrits_drop(str_trits)
    return out
  }

  function getMamRoot(SEED, CHANNEL) {
    let SEED_trits = string_to_ctrits_trits(SEED)
    let root_merkle = iota_merkle_create(
      SEED_trits,
      CHANNEL.start,
      CHANNEL.count,
      CHANNEL.security
    )
    return ctrits_trits_to_string(iota_merkle_slice(root_merkle))
  }

  function createMessage(SEED, MESSAGE, SIDE_KEY, CHANNEL) {
    if (!SIDE_KEY)
      SIDE_KEY = `999999999999999999999999999999999999999999999999999999999999999999999999999999999`
    // MAM settings
    let SEED_trits = string_to_ctrits_trits(SEED)
    let MESSAGE_trits = string_to_ctrits_trits(MESSAGE)
    let SIDE_KEY_trits = string_to_ctrits_trits(SIDE_KEY)

    const SECURITY = CHANNEL.security
    const START = CHANNEL.start
    const COUNT = CHANNEL.count
    const NEXT_START = START + COUNT
    const NEXT_COUNT = CHANNEL.next_count
    const INDEX = CHANNEL.index

    const HASH_LENGTH = 81

    // set up merkle tree
    let root_merkle = iota_merkle_create(SEED_trits, START, COUNT, SECURITY)
    let next_root_merkle = iota_merkle_create(
      SEED_trits,
      NEXT_START,
      NEXT_COUNT,
      SECURITY
    )

    let root_branch = iota_merkle_branch(root_merkle, INDEX)
    let root_siblings = iota_merkle_siblings(root_branch)

    let next_root_branch = iota_merkle_branch(next_root_merkle, INDEX)
    let next_root_siblings = iota_merkle_siblings(next_root_branch)

    let root = iota_merkle_slice(root_merkle)
    let next_root = iota_merkle_slice(next_root_merkle)

    let masked_payload = iota_mam_create(
      SEED_trits,
      MESSAGE_trits,
      SIDE_KEY_trits,
      root,
      root_siblings,
      next_root,
      START,
      INDEX,
      SECURITY
    )

    let response = {
      payload: ctrits_trits_to_string(masked_payload),
      root: ctrits_trits_to_string(root),
      next_root: ctrits_trits_to_string(next_root),
      side_key: SIDE_KEY
    }
    // Clean up memory. Unneccessary for this example script, but should be done when running in a production
    // environment.
    iota_merkle_branch_drop(root_branch)
    iota_merkle_branch_drop(next_root_branch)
    iota_merkle_drop(root_merkle)
    iota_merkle_drop(next_root_merkle)
    ;[SEED_trits, MESSAGE_trits, SIDE_KEY_trits, root, next_root].forEach(
      iota_ctrits_drop
    )
    return response
  }

  function decodeMessage(PAYLOAD, SIDE_KEY, ROOT) {
    if (!SIDE_KEY)
      SIDE_KEY = `999999999999999999999999999999999999999999999999999999999999999999999999999999999`

    let PAYLOAD_trits = string_to_ctrits_trits(PAYLOAD)
    let SIDE_KEY_trits = string_to_ctrits_trits(SIDE_KEY)
    let ROOT_trits = string_to_ctrits_trits(ROOT)

    let parse_result = iota_mam_parse(PAYLOAD_trits, SIDE_KEY_trits, ROOT_trits)
    let unmasked_payload_ctrits = IOTA.getValue(parse_result, 'i32')
    let unmasked_payload = ctrits_trits_to_string(unmasked_payload_ctrits)
    iota_ctrits_drop(unmasked_payload_ctrits)

    let unmasked_next_root_ctrits = IOTA.getValue(parse_result + 4, 'i32')
    let unmasked_next_root = ctrits_trits_to_string(unmasked_next_root_ctrits)
    iota_ctrits_drop(unmasked_next_root_ctrits)
    IOTA._free(parse_result)
    return { payload: unmasked_payload, next_root: unmasked_next_root }
  }

  window.Mam = module.exports = {
    init: init,
    subscribe: subscribe,
    create: create,
    decode: decode,
    fetch: fetch,
    attach: attach,
    listen: listen,
    getRoot: getRoot
  }
})
