"""The few ABI shapes the fetch needs: static words, one string, and Multicall3 aggregate3."""

WORD = 32
UINT256_MAX = (1 << 256) - 1


def word(value: int) -> str:
    if not 0 <= value <= UINT256_MAX:
        raise ValueError(f"{value} does not fit a uint256 word")
    return f"{value:064x}"


def address_word(address: str) -> str:
    body = address.lower().removeprefix("0x")
    if len(body) != 40:
        raise ValueError(f"not an address: {address}")
    return body.rjust(64, "0")


def call_data(selector: str, *words: str) -> str:
    return selector + "".join(words)


def strip(hex_data: str) -> bytes:
    return bytes.fromhex(hex_data.removeprefix("0x"))


def words(data: bytes) -> list[int]:
    if len(data) % WORD:
        raise ValueError(f"return data of {len(data)} bytes is not whole words")
    return [int.from_bytes(data[i : i + WORD], "big") for i in range(0, len(data), WORD)]


def signed(value: int) -> int:
    return value - (1 << 256) if value >> 255 else value


def to_address(value: int) -> str:
    if value >> 160:
        raise ValueError(f"word {value:#x} is not an address")
    return "0x" + f"{value:040x}"


def decode_string(data: bytes) -> str:
    offset = int.from_bytes(data[:WORD], "big")
    length = int.from_bytes(data[offset : offset + WORD], "big")
    return data[offset + WORD : offset + WORD + length].decode("utf-8")


def _pad(data: bytes) -> bytes:
    return data + b"\x00" * (-len(data) % WORD)


def encode_aggregate3(selector: str, calls: list[tuple[str, bool, bytes]]) -> str:
    """aggregate3((address,bool,bytes)[]): one dynamic array of dynamic tuples."""
    encoded = []
    for target, allow_failure, data in calls:
        head = bytes.fromhex(address_word(target)) + (1 if allow_failure else 0).to_bytes(WORD, "big")
        head += (3 * WORD).to_bytes(WORD, "big")
        encoded.append(head + len(data).to_bytes(WORD, "big") + _pad(data))
    offsets, position = [], len(calls) * WORD
    for item in encoded:
        offsets.append(position)
        position += len(item)
    body = WORD.to_bytes(WORD, "big") + len(calls).to_bytes(WORD, "big")
    body += b"".join(o.to_bytes(WORD, "big") for o in offsets) + b"".join(encoded)
    return selector + body.hex()


def decode_aggregate3(data: bytes) -> list[tuple[bool, bytes]]:
    """(bool,bytes)[] as aggregate3 returns it."""
    array = int.from_bytes(data[:WORD], "big")
    count = int.from_bytes(data[array : array + WORD], "big")
    start = array + WORD
    out = []
    for i in range(count):
        item = start + int.from_bytes(data[start + i * WORD : start + (i + 1) * WORD], "big")
        success = int.from_bytes(data[item : item + WORD], "big")
        if success not in (0, 1):
            raise ValueError(f"aggregate3 result {i} has success word {success}")
        blob = item + int.from_bytes(data[item + WORD : item + 2 * WORD], "big")
        length = int.from_bytes(data[blob : blob + WORD], "big")
        out.append((bool(success), data[blob + WORD : blob + WORD + length]))
    return out
