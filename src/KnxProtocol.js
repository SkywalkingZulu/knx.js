/**
* knx.js - a pure Javascript library for KNX
* (C) 2016 Elias Karakoulakis
*/
var util = require('util');
var ipv4 = require('ipv4.js');
var Parser = require('binary-parser').Parser;
var BinaryProtocol = require('binary-protocol');
var KnxProtocol = new BinaryProtocol();
var KnxAddress = require('./Address');
var KnxConstants = require ('./KnxConstants');

// defaults
KnxProtocol.twoLevelAddressing = false;
KnxProtocol.lengths = {};

// helper function: what is the byte length of an object?
function knxlen(objectName, context) {
  var lf = KnxProtocol.lengths[objectName];
  if (typeof lf === 'function') {
    if (!context) throw "Length functions require a context";
    var val = lf(context);
    if (!val) throw "No value returned by length function for "+objectName;
    return val
  }
  else
    return lf;
}
//
KnxProtocol.define('IPv4Endpoint', {
  read: function (propertyName) {
    this.pushStack({ addr: null, port: null})
      .UInt32BE('addr')
      .UInt16BE('port')
      .popStack(propertyName, function (data) {
        return ipv4.ntoa(data.addr) + ':' + data.port;
       });
     },
  write: function (value) {
    if (!value) throw "cannot write null value for IPv4Endpoint"
    else {
      if (!(typeof value === 'string' && value.match(/\d*\.\d*\.\d*\.\d*:\d*/))) {
        throw "Invalid IPv4 endpoint, please set a string as  'ip.add.re.ss:port'";
      }
      var arr = value.split(':');
      this.UInt32BE(ipv4.aton(arr[0]));
      this.UInt16BE(arr[1]);
    }
  }
});
KnxProtocol.lengths['IPv4Endpoint'] = 6;

/* CRI: connection request/response */
// creq[22] = 0x04;  /* structure len (4 bytes) */
// creq[23] = 0x04;  /* connection type: DEVICE_MGMT_CONNECTION = 0x03; TUNNEL_CONNECTION = 0x04; */
// creq[24] = 0x02;  /* KNX Layer (Tunnel Link Layer) */
// creq[25] = 0x00;  /* Reserved */
// ==> 4 bytes
KnxProtocol.define('CRI', {
  read: function (propertyName) {
    this
    .pushStack({ header_length: 0, connection_type: null, knx_layer: null, unused:null}) //
    .UInt8('header_length')
    .UInt8('connection_type')
    .UInt8('knx_layer')
    .UInt8('unused')
    .tap(function (hdr) {
      switch (hdr.connection_type) {
        case KnxConstants.CONNECTION_TYPE.DEVICE_MGMT_CONNECTION:
          break; // TODO
        case KnxConstants.CONNECTION_TYPE.TUNNEL_CONNECTION:
          break; // TODO
        default: throw "Unsupported connection type: " + hdr.connection_type;
      }
    })
    .popStack(propertyName, function (data) {
      //if (KnxProtocol.debug) console.log('read CRI: '+JSON.stringify(data));
      // pop the interim value off the stack and insert the real value into `propertyName`
      return data
    });
  },
  write: function (value) {
    if (!value) console.trace("CRI: cannot write null value for CRI")
    else {
      this
        .UInt8(0x04) // length
        .UInt8(value.connection_type)
        .UInt8(value.knx_layer)
        .UInt8(value.unused);
    }
  }
});
KnxProtocol.lengths['CRI'] = 4;

// connection state response/request
KnxProtocol.define('ConnState', {
  read: function (propertyName) {
    this.pushStack({  channel_id: null, status: null })
    .UInt8('channel_id')
    .UInt8('status')
    .popStack(propertyName, function (data) {
      //if (KnxProtocol.debug) console.log('read ConnState: %j', data);
      return data;
    });
  },
  write: function (value) {
    if (!value) console.trace("cannot write null value for ConnState")
    else {
      this
        .UInt8(value.channel_id)
        .UInt8(value.status);
    }
  }
});
KnxProtocol.lengths['ConnState'] = 2;

// connection state response/request
KnxProtocol.define('TunnState', {
  read: function (propertyName) {
    this.pushStack({ header_length: null, channel_id: null, seqnum: null, rsvd: null})
    .UInt8('header_length')
    .UInt8('channel_id')
    .UInt8('seqnum')
    .UInt8('rsvd')
    .tap(function (hdr) {
      //if (KnxProtocol.debug) console.log('reading TunnState: %j', hdr);
      switch (hdr.status) {
        case 0x00:
          break;
        //default: throw "Connection State status: " + hdr.status;
      }
      return hdr;
    })
    .popStack(propertyName, function (data) {
      return data;
    });
  },
  write: function (value) {
    if (!value) console.trace("TunnState: cannot write null value for TunnState")
    else {
      //if (KnxProtocol.debug) console.log('writing TunnState: %j', value);
      this
        .UInt8(0x04)
        .UInt8(value.channel_id)
        .UInt8(value.seqnum)
        .UInt8(value.rsvd);
    }
  }
});
KnxProtocol.lengths['TunnState'] = 4;

/* Connection HPAI */
//   creq[6]     =  /* Host Protocol Address Information (HPAI) Lenght */
//   creq[7]     =  /* IPv4 protocol UDP = 0x01, TCP = 0x02; */
//   creq[8-11]  =  /* IPv4 address  */
//   creq[12-13] =  /* IPv4 local port number for CONNECTION, CONNECTIONSTAT and DISCONNECT requests */
// ==> 8 bytes

/* Tunneling HPAI */
//   creq[14]    =  /* Host Protocol Address Information (HPAI) Lenght */
//   creq[15]    =  /* IPv4 protocol UDP = 0x01, TCP = 0x02; */
//   creq[16-19] =  /* IPv4 address  */
//   creq[20-21] =  /* IPv4 local port number for TUNNELING requests */
// ==> 8 bytes
KnxProtocol.define('HPAI', {
  read: function (propertyName) {
    this.pushStack({ header_length: 8, protocol_type: null, tunnel_endpoint: null})
    .UInt8('header_length')
    .UInt8('protocol_type')
    .IPv4Endpoint('tunnel_endpoint')
    .tap(function (hdr) {
      if (this.buffer.length < hdr.header_length) {
        //console.log('%d %d %d', this.buffer.length, this.offset, hdr.header_length);
        throw "Incomplete KNXNet HPAI header";
      }
/*
      if (KnxProtocol.debug) {
        console.log('read HPAI: %j', hdr);
        console.log("     HPAI: proto = %s", KnxConstants.keyText('PROTOCOL_TYPE', hdr.protocol_type));
      }
*/
      switch (hdr.protocol_type) {
        case KnxConstants.PROTOCOL_TYPE.IPV4_TCP:
          throw "TCP is not supported";
        default:
      }
    })
    .popStack(propertyName, function (data) {
      return data;
    });
  },
  write: function (value) {
    if (!value) console.trace("HPAI: cannot write null value for HPAI")
    else {
      this
        .UInt8(0x08) // length: 8 bytes
        .UInt8(value.protocol_type)
        .IPv4Endpoint(value.tunnel_endpoint);
    }
  }
});
KnxProtocol.lengths['HPAI'] = 8;

/* ==================== APCI ====================== */
//
//  Message Code    = 0x11 - a L_Data.req primitive
//      COMMON EMI MESSAGE CODES FOR DATA LINK LAYER PRIMITIVES
//          FROM NETWORK LAYER TO DATA LINK LAYER
//          +---------------------------+--------------+-------------------------+---------------------+------------------+
//          | Data Link Layer Primitive | Message Code | Data Link Layer Service | Service Description | Common EMI Frame |
//          +---------------------------+--------------+-------------------------+---------------------+------------------+
//          |        L_Raw.req          |    0x10      |                         |                     |                  |
//          +---------------------------+--------------+-------------------------+---------------------+------------------+
//          |                           |              |                         | Primitive used for  | Sample Common    |
//          |        L_Data.req         |    0x11      |      Data Service       | transmitting a data | EMI frame        |
//          |                           |              |                         | frame               |                  |
//          +---------------------------+--------------+-------------------------+---------------------+------------------+
//          |        L_Poll_Data.req    |    0x13      |    Poll Data Service    |                     |                  |
//          +---------------------------+--------------+-------------------------+---------------------+------------------+
//          |        L_Raw.req          |    0x10      |                         |                     |                  |
//          +---------------------------+--------------+-------------------------+---------------------+------------------+
//          FROM DATA LINK LAYER TO NETWORK LAYER
//          +---------------------------+--------------+-------------------------+---------------------+
//          | Data Link Layer Primitive | Message Code | Data Link Layer Service | Service Description |
//          +---------------------------+--------------+-------------------------+---------------------+
//          |        L_Poll_Data.con    |    0x25      |    Poll Data Service    |                     |
//          +---------------------------+--------------+-------------------------+---------------------+
//          |                           |              |                         | Primitive used for  |
//          |        L_Data.ind         |    0x29      |      Data Service       | receiving a data    |
//          |                           |              |                         | frame               |
//          +---------------------------+--------------+-------------------------+---------------------+
//          |        L_Busmon.ind       |    0x2B      |   Bus Monitor Service   |                     |
//          +---------------------------+--------------+-------------------------+---------------------+
//          |        L_Raw.ind          |    0x2D      |                         |                     |
//          +---------------------------+--------------+-------------------------+---------------------+
//          |                           |              |                         | Primitive used for  |
//          |                           |              |                         | local confirmation  |
//          |        L_Data.con         |    0x2E      |      Data Service       | that a frame was    |
//          |                           |              |                         | sent (does not mean |
//          |                           |              |                         | successful receive) |
//          +---------------------------+--------------+-------------------------+---------------------+
//          |        L_Raw.con          |    0x2F      |                         |                     |
//          +---------------------------+--------------+-------------------------+---------------------+

//  Add.Info Length = 0x00 - no additional info
//  Control Field 1 = see the bit structure above
//  Control Field 2 = see the bit structure above
//  Source Address  = 0x0000 - filled in by router/gateway with its source address which is
//                    part of the KNX subnet
//  Dest. Address   = KNX group or individual address (2 byte)
//  Data Length     = Number of bytes of data in the APDU excluding the TPCI/APCI bits
//  APDU            = Application Protocol Data Unit - the actual payload including transport
//                    protocol control information (TPCI), application protocol control
//                    information (APCI) and data passed as an argument from higher layers of
//                    the KNX communication stack


/* ==================== CEMI ====================== */

// CEMI (start at position 6)
// +--------+--------+--------+--------+----------------+----------------+--------+----------------+
// |  Msg   |Add.Info| Ctrl 1 | Ctrl 2 | Source Address | Dest. Address  |  Data  |      APDU      |
// | Code   | Length |        |        |                |                | Length |                |
// +--------+--------+--------+--------+----------------+----------------+--------+----------------+
//   1 byte   1 byte   1 byte   1 byte      2 bytes          2 bytes       1 byte      2 bytes
/*
Control Field 1
          Bit  |
         ------+---------------------------------------------------------------
           7   | Frame Type  - 0x0 for extended frame
               |               0x1 for standard frame
         ------+---------------------------------------------------------------
           6   | Reserved
         ------+---------------------------------------------------------------
           5   | Repeat Flag - 0x0 repeat frame on medium in case of an error
               |               0x1 do not repeat
         ------+---------------------------------------------------------------
           4   | System Broadcast - 0x0 system broadcast
               |                    0x1 broadcast
         ------+---------------------------------------------------------------
           3   | Priority    - 0x0 system
               |               0x1 normal
         ------+               0x2 urgent
           2   |       service_type: -1,        0x3 low
         ------+---------------------------------------------------------------
           1   | Acknowledge Request - 0x0 no ACK requested
               | (L_Data.req)          0x1 ACK requested
         ------+---------------------------------------------------------------
           0   | Confirm      - 0x0 no error
               | (L_Data.con) - 0x1 error
         ------+---------------------------------------------------------------
Control Field 2
          Bit  |
         ------+---------------------------------------------------------------
           7   | Destination Address Type - 0x0 physical address, 0x1 group address
         ------+---------------------------------------------------------------
          6-4  | Hop Count (0-7)
         ------+---------------------------------------------------------------
          3-0  | Extended Frame Format - 0x0 standard frame
         ------+---------------------------------------------------------------
*/
// In the Common EMI frame, the APDU payload is defined as follows:

// +--------+--------+--------+--------+--------+
// | TPCI + | APCI + |  Data  |  Data  |  Data  |
// |  APCI  |  Data  |        |        |        |
// +--------+--------+--------+--------+--------+
//   byte 1   byte 2  byte 3     ...     byte 16

// For data that is 6 bits or less in length, only the first two bytes are used in a Common EMI
// frame. Common EMI frame also carries the information of the expected length of the Protocol
// Data Unit (PDU). Data payload can be at most 14 bytes long.  <p>

// The first byte is a combination of transport layer control information (TPCI) and application
// layer control information (APCI). First 6 bits are dedicated for TPCI while the two least
// significant bits of first byte hold the two most significant bits of APCI field, as follows:

//   Bit 1    Bit 2    Bit 3    Bit 4    Bit 5    Bit 6    Bit 7    Bit 8      Bit 1   Bit 2
// +--------+--------+--------+--------+--------+--------+--------+--------++--------+----....
// |        |        |        |        |        |        |        |        ||        |
// |  TPCI  |  TPCI  |  TPCI  |  TPCI  |  TPCI  |  TPCI  | APCI   |  APCI  ||  APCI  |
// |        |        |        |        |        |        |(bit 1) |(bit 2) ||(bit 3) |
// +--------+--------+--------+--------+--------+--------+--------+--------++--------+----....
// +                            B  Y  T  E    1                            ||       B Y T E  2
// +-----------------------------------------------------------------------++-------------....

//Total number of APCI control bits can be either 4 or 10. The second byte bit structure is as follows:

//   Bit 1    Bit 2    Bit 3    Bit 4    Bit 5    Bit 6    Bit 7    Bit 8      Bit 1   Bit 2
// +--------+--------+--------+--------+--------+--------+--------+--------++--------+----....
// |        |        |        |        |        |        |        |        ||        |
// |  APCI  |  APCI  | APCI/  |  APCI/ |  APCI/ |  APCI/ | APCI/  |  APCI/ ||  Data  |  Data
// |(bit 3) |(bit 4) | Data   |  Data  |  Data  |  Data  | Data   |  Data  ||        |
// +--------+--------+--------+--------+--------+--------+--------+--------++--------+----....
// +                            B  Y  T  E    2                            ||       B Y T E  3
// +-----------------------------------------------------------------------++-------------....

// control field
var ctrlStruct = new Parser()
  // byte 1
  .bit1('frameType')
  .bit1('reserved')
  .bit1('repeat')
  .bit1('broadcast')
  .bit2('priority')
  .bit1('acknowledge')
  .bit1('confirm')
  // byte 2
  .bit1('destAddrType')
  .bit3('hopCount')
  .bit4('extendedFrame');

// most common APDU: 2 bytes, tcpi = 6 bits, apci = 4 bits, remaining 6 bits = data
var apduStruct = new Parser()
  .bit6('tpci')
  .bit4('apci')
  .bit6('data')

// less common APDU: tpci = 6 bits, apci= 10 bits, data follows
var apduStructLong = new Parser()
  .bit6('tpci')
  .bit10('apci')

KnxProtocol.define('APDU', {
  read: function (propertyName) {
    this.pushStack({ apdu_length: null, apdu_raw: null, tpci: null, apci: null, data: null })
    .UInt8('apdu_length')
    .tap(function (hdr) {
      //console.log('--- parsing extra %d apdu bytes', hdr.apdu_length+1);
      this.raw('apdu_raw', hdr.apdu_length+1);
    })
    .tap(function (hdr) {
      // Parse the APDU. tcpi/apci bits split across byte boundary.
      // Typical example of protocol designed by committee.
      //console.log('%j', hdr)
      var apdu;
      if (hdr.apdu_length == 1) {
        apdu = apduStruct.parse(hdr.apdu_raw);
      } else {
        apdu = apduStructLong.parse(hdr.apdu_raw);
        apdu.data = hdr.apdu_raw.slice(2);
      }
      hdr.tpci = apdu.tpci;
      hdr.apci = apdu.apci;
      hdr.data = apdu.data;
    })
    .popStack(propertyName, function (data) {
      return data;
    });
  },
  write: function (value) {
    if (!value)      throw "cannot write null APDU value";
    var total_length = knxlen('APDU', value);
    //console.log('APDU.write: \t%j (total %d bytes)', value, total_length);
    if (total_length < 3) throw util.format("APDU is too short (%d bytes)", total_length);
    this.UInt8(total_length - 2);
    if (total_length == 3) {
      // commonest case:
      // apdu_length(1 byte) + tpci: 6 bits + apci: 4 bits, data: 6 bits (2 bytes)
      var word =
        value.tpci * 0x400 +
        value.apci * 0x40 +
        value.data;
      //console.log('data==%d', value.data)
      this.UInt16BE(word);
    } else {
      // tpci:6 bits + apci:10 bits
      var word =
        value.tpci * 0x400 +
        value.apci ;
      this.UInt16BE(word);
      this.raw(value.data || new Buffer(), total_length-3);
    }
  }
});
KnxProtocol.lengths['APDU'] = function(value) {
//console.log(value);
  if (value instanceof Buffer) {
    return 1 + value.length;
  } else {
    return 3; // hard assumption
  }
}

KnxProtocol.define('CEMI', {
  read: function (propertyName) {
    this.pushStack({ msgcode: 0, addinfo_length: -1, ctrl: null, src_addr: null, dest_addr: null, apdu: null })
    .UInt8('msgcode')
    .UInt8('addinfo_length')
    .raw('ctrl', 2)
    .raw('src_addr', 2)
    .raw('dest_addr', 2)
    .APDU('apdu')
    .tap(function (hdr) {
      //console.log('--- APDU as seen from CEMI==%j', hdr.apdu);
      // parse 16bit control field
      hdr.ctrl = ctrlStruct.parse(hdr.ctrl);
      // KNX source addresses are always physical
      hdr.src_addr  = KnxAddress.toString(hdr.src_addr, KnxAddress.TYPE.PHYSICAL);
      hdr.dest_addr = KnxAddress.toString(hdr.dest_addr, hdr.ctrl.destAddrType);
      return hdr;
    })
    .popStack(propertyName, function (data) {
      return data;
    });
  },
  write: function (value) {
    if (!value)      throw "cannot write null CEMI value";
    //console.log('CEMI.write: \n\t%j', value);
    if (value.apdu === null) throw "no APDU supplied";
    if (value.ctrl === null) throw "no Control Field supplied";
    var ctrlField1 =
      value.ctrl.frameType   * 0x80 +
      value.ctrl.reserved    * 0x40 +
      value.ctrl.repeat      * 0x20 +
      value.ctrl.broadcast   * 0x10 +
      value.ctrl.priority    * 0x04 +
      value.ctrl.acknowledge * 0x02 +
      value.ctrl.confirm;
    var ctrlField2 =
      value.ctrl.destAddrType* 0x80 +
      value.ctrl.hopCount    * 0x10 +
      value.ctrl.extendedFrame;
    this
      .UInt8(value.msgcode)
      .UInt8(value.addinfo_length)
      .UInt8(ctrlField1)
      .UInt8(ctrlField2)
      .raw(KnxAddress.parse(value.src_addr, KnxAddress.TYPE.PHYSICAL), 2)
      .raw(KnxAddress.parse(value.dest_addr, value.ctrl.destAddrType), 2)
      .APDU(value.apdu);
  }
});
KnxProtocol.lengths['CEMI'] = function(value) {
  var apdu_length = knxlen('APDU', value.apdu);
  //console.log('knxlen of cemi: %j == %d', value, 8 + apdu_length);
  return 8 + apdu_length;
}

KnxProtocol.define('KNXNetHeader', {
  read: function (propertyName) {
    // if (KnxProtocol.debug) console.log('reading KNXNetHeader');
    this.pushStack({ header_length: 0, protocol_version: -1, service_type: -1, total_length: 0})
    .UInt8   ('header_length')
    .UInt8   ('protocol_version')
    .UInt16BE('service_type')
    .UInt16BE('total_length')
    .tap(function (hdr) {
      // FIXME: if (this.buffer.length - this.offset < hdr.header_length)
      //  throw util.format("Incomplete KNXNet header: %d - %d < %d", this.buffer.length, this.offset, hdr.header_length);
      switch (hdr.service_type) {
//        case SERVICE_TYPE.SEARCH_REQUEST:
        case KnxConstants.SERVICE_TYPE.CONNECT_REQUEST: {
          this
            .HPAI('hpai')
            .HPAI('tunn')
            .CRI('cri');
           break;
        }
        case KnxConstants.SERVICE_TYPE.CONNECT_RESPONSE: {
          this
            .ConnState('connstate')
            .HPAI('hpai')
            .CRI('cri');
          break;
        }
        case KnxConstants.SERVICE_TYPE.CONNECTIONSTATE_REQUEST:
        case KnxConstants.SERVICE_TYPE.DISCONNECT_REQUEST: {
          this
            .ConnState('connstate')
            .HPAI('hpai');
          break;
        }
        case KnxConstants.SERVICE_TYPE.CONNECTIONSTATE_RESPONSE:
        case KnxConstants.SERVICE_TYPE.DISCONNECT_RESPONSE: {
          this.ConnState('connstate');
          break;
        }
        case KnxConstants.SERVICE_TYPE.DESCRIPTION_RESPONSE: {
          this.raw('value', hdr.total_length);
          break;
        }
        // most common case:
        case KnxConstants.SERVICE_TYPE.TUNNELING_REQUEST: {
          this
            .TunnState('tunnstate')
            .CEMI('cemi');
          break;
        }
        case KnxConstants.SERVICE_TYPE.TUNNELING_ACK: {
          this
            .TunnState('connstate');
          break;
        }
        default: {
          console.trace("read KNXNetHeader: unhandled serviceType = %s", KnxConstants.keyText('SERVICE_TYPE', hdr.service_type));
        }
      }
    })
    .popStack(propertyName, function (data) {
      //if (KnxProtocol.debug) console.log(JSON.stringify(data, null, 4));
      return data;
    });
  },
  write: function (value) {
    //console.log("writing KnxHeader:", value);
    if (!value) throw "cannot write null KNXNetHeader value"
    value.total_length = 6;
    this
      .UInt8(6)    // header length (6 bytes constant)
      .UInt8(0x10) // protocol version 1.0
      .UInt16BE(value.service_type);
    switch (value.service_type) {
      //case SERVICE_TYPE.SEARCH_REQUEST:
      case KnxConstants.SERVICE_TYPE.CONNECT_REQUEST:
      case KnxConstants.SERVICE_TYPE.DISCONNECT_REQUEST: {
        value.total_length += 2*knxlen('HPAI')+ knxlen('CRI');
        this
          .UInt16BE(value.total_length) //
          .HPAI(value.hpai)
          .HPAI(value.tunn)
          .CRI(value.cri);
        break;
      }
      case KnxConstants.SERVICE_TYPE.CONNECT_RESPONSE: {
        value.total_length += knxlen('ConnState')+ knxlen('HPAI') + knxlen('CRI');
        this
          .UInt16BE(value.total_length) // total length
          .ConnState(value.connstate)
          .HPAI(value.hpai)
          .CRI(value.cri);
        break;
      }
      case KnxConstants.SERVICE_TYPE.CONNECTIONSTATE_REQUEST: {
        value.total_length += knxlen('ConnState') + knxlen('HPAI') ;
        this
          .UInt16BE(value.total_length) //
          .ConnState(value.connstate)
          .HPAI(value.hpai)
          // TODO
        break;
      }
      case KnxConstants.SERVICE_TYPE.CONNECTIONSTATE_RESPONSE: {
        value.total_length += knxlen('ConnState');
        this
          .UInt16BE(value.total_length) //
          .ConnState(value.conn_state);
        break;
      }
      // most common case:
      case KnxConstants.SERVICE_TYPE.TUNNELING_REQUEST: {
        value.total_length += (knxlen('TunnState') + knxlen('CEMI', value.cemi));
        this
          .UInt16BE(value.total_length)
          .TunnState(value.tunnstate)
          .CEMI(value.cemi);
        break;
      }
      case KnxConstants.SERVICE_TYPE.TUNNELING_ACK: {
        value.total_length += knxlen('TunnState');
        this
          .UInt16BE(value.total_length) //
          .TunnState(value.tunnstate);
        break;
      }
      // case KnxConstants.SERVICE_TYPE.DESCRIPTION_RESPONSE: {
      default: {
        throw util.format(
          "write KNXNetHeader: unhandled serviceType = %s (%j)",
          KnxConstants.keyText('SERVICE_TYPE', value), value);
      }

    }
  }
});

module.exports = KnxProtocol;
