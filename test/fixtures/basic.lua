#!/usr/bin/env lua
-- A small bakery helper. The words function "quotes" and [[brackets]] in this comment stay comments.

--[[
This block comment says function and end and "quotes",
but it is all comment until the closing brackets.
]]

--[==[
A deeper comment can hold ]] and still go on
until the matching one.
]==]

---[[ This is only a one line comment, even with the brackets
local print_me = true

local MAX_LOAVES = 1000
local mask = 0xFF
local ratio = 1.5e-3
local half = .5
local hexfloat = 0xA.8p0
local power = 0x1p4
local span = 1 .. 2

local text = "She said \"hi\" and left\n"
local single = 'it\'s warm'
local joined = "first part \z
                second part"
local note = [[
A long string can hold "quotes" and
span many lines.
]]
local fancy = [==[has ]] and ]=] inside]==]

local Loaf = {}
Loaf.__index = Loaf

-- Makes a new loaf with a name and a weight.
function Loaf.new(name, weight)
  local self = setmetatable({}, Loaf)
  self.name = name
  self.weight = weight or 500
  return self
end

function Loaf:describe()
  return string.format("%s weighs %d", self.name, self.weight)
end

local function slices(loaf, count)
  local result = {}
  for i = 1, count do
    result[#result + 1] = loaf.weight // count
  end
  return result
end

local a, b <const> = 1, 2
local handle <close> = nil
local table = {}
local type = "rye"

local loaves = { Loaf.new("plain", 400), Loaf.new("rye", 650) }
for index, loaf in ipairs(loaves) do
  if loaf.weight > 500 and not loaf.sold then
    print(loaf:describe())
  elseif loaf.weight == 400 then
    goto continue
  else
    print "small loaf"
  end
  ::continue::
end

local count = 0
while count < 3 do
  count = count + 1
  if count == 2 then break end
end

repeat
  count = count - 1
until count <= 0

local ok, err = pcall(function()
  error("oven is cold")
end)
print(ok, err, #loaves, 2 ^ 3, 7 % 2, a ~= b, "a" .. "b")

return Loaf
