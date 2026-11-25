% A small bakery helper. The words function and 'quotes' in this comment stay comments.

%{
This block comment says function and end and "quotes",
but it is all comment until the closing line.
%{
A nested block comment.
%}
Still comment here.
%}

MAX_LOAVES = 1000;
mask = 0x1F;
bits = 0b101;
small = 0xFFu8;
ratio = 1.5e-3;
half = .5;
one = 1;
nine = 9.;
voltage = 3 + 2i;
phase = 2.5j;
doubled = 1.*2;
inverse = 1./x;
limit = Inf;
missing = NaN;

name = 'Rye loaf';
quote = 'it''s warm';
label = "She said ""hi"" % not a comment";
percent = '% not a comment either';
broken = 'no end

function total = total_weight(weights, extra)
  % Adds up the weights.
  if isempty(weights)
    total = extra;
    return
  elseif numel(weights) == 1
    total = weights(1) + extra;
  else
    total = sum(weights) + extra;
  end
end

function [low, high] = spread(values)
  low = min(values);
  high = max(values);
end

function disp(obj)
  fprintf('%d loaves\n', obj.count);
end

M = [1 2 3; 4 5 6];
flipped = M';
column = [1 2 3]';
last = weights(end)';
both = M'*M';
twice = M'';
plain_dot = M.';
words = ['rye' 'wheat'];
mixed = [name' 'x'];
cells = {'a', 'b', "c"};
tail = names{end}';

for i = 1:3
  if i == 2, continue; end
  fprintf('loaf %d\n', i);
end

while true
  break
end

switch name
  case 'Rye loaf'
    disp('rye');
  case {'wheat', 'spelt'}
    disp('other');
  otherwise
    disp('none');
end

try
  error('Bakery:oven', 'too hot');
catch err
  disp(err.message);
end

total = 1 + 2 + ...
        3 + 4;
total = 1 + 2 ... this part is a comment, 'quotes' and all
        + 3;

square = @(x) x.^2;
result = arrayfun(@(k) k*2, 1:5);
s.end = 5;
s.size = 6;
size = 4;

classdef Loaf < handle
  properties (Access = public)
    weight = 750;
  end
  methods
    function obj = Loaf(w)
      obj.weight = w;
    end
  end
end
