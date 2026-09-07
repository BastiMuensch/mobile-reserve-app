import assert from 'node:assert/strict';
import test from 'node:test';
import { buttonVariants } from '../src/components/ui/button';

test('link buttons resolve the same default size and outline utilities as buttons', () => {
  const classes = buttonVariants({ variant: 'outline' }).split(' ');
  for (const expected of ['min-h-10', 'gap-2', 'px-4', 'py-2', 'rounded-lg', 'border-border', 'whitespace-normal']) {
    assert.ok(classes.includes(expected), expected);
  }
  assert.ok(!classes.includes('border-transparent'));
  assert.ok(!classes.includes('whitespace-nowrap'));
});

test('link action overrides resolve without competing border or hover colors', () => {
  const classes = buttonVariants({ variant: 'outline', className: 'border-primary/40 text-primary hover:bg-primary/5 hover:text-primary' }).split(' ');
  assert.ok(classes.includes('border-primary/40'));
  assert.ok(classes.includes('hover:text-primary'));
  assert.ok(!classes.includes('border-border'));
  assert.ok(!classes.includes('hover:text-foreground'));
});

test('compact and icon actions retain explicit, consistent size variants', () => {
  assert.ok(buttonVariants({ size: 'sm' }).split(' ').includes('h-8'));
  assert.ok(buttonVariants({ size: 'icon' }).split(' ').includes('size-10'));
  assert.ok(buttonVariants({ size: 'icon-sm' }).split(' ').includes('size-8'));
  assert.ok(!buttonVariants({ size: 'sm' }).split(' ').includes('min-h-10'));
});
