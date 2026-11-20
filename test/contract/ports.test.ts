import { describe, expect, it } from 'vitest';
import { PORTS_MAX, PORT_MAX, PORT_MIN, portVariables, portsProblems } from '../../src/contract/ports.ts';
import type { ProjectPorts } from '../../src/contract/ports.ts';

/** The ports of Smoke Desk, the example of the design. */
const smoke: ProjectPorts = {
  client: {
    port: 5173,
    open: true,
    label: { en: 'Smoke Desk', pt: 'Smoke Desk' },
    variables: { CLIENT_ORIGIN: 'http://localhost:{{port}}' },
  },
  api: { port: 3001 },
  audit: {
    port: 3002,
    label: { en: 'Audit service', pt: 'Serviço de auditoria' },
    variables: { VITE_AUDIT_URL: 'http://localhost:{{port}}' },
  },
};

describe('a project ports declaration', () => {
  it('accepts the Smoke Desk declaration', () => {
    expect(portsProblems({ ports: smoke })).toEqual([]);
  });

  it('accepts a project without ports', () => {
    expect(portsProblems({})).toEqual([]);
  });

  it('refuses ports without client', () => {
    const { client: _client, ...rest } = smoke;
    const problems = portsProblems({ ports: rest });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^ports: .*client/);
  });

  it(`refuses a port below ${PORT_MIN} or above ${PORT_MAX}`, () => {
    expect(portsProblems({ ports: { ...smoke, api: { port: 80 } } })[0]).toMatch(/^ports\.api\.port: /);
    expect(portsProblems({ ports: { ...smoke, api: { port: PORT_MAX + 1 } } })[0]).toMatch(/^ports\.api\.port: /);
    expect(portsProblems({ ports: { ...smoke, api: { port: PORT_MAX } } })).toEqual([]);
  });

  it('refuses two names on one port', () => {
    const problems = portsProblems({ ports: { ...smoke, admin: { port: 3001 } } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^ports\.admin\.port: .*api/);
  });

  it(`refuses more than ${PORTS_MAX} ports`, () => {
    const many = Object.fromEntries(
      Array.from({ length: PORTS_MAX }, (_, index) => [`extra-${index}`, { port: 4000 + index }]),
    );
    expect(portsProblems({ ports: { client: { port: 5173 }, ...many } })[0]).toMatch(/^ports: at most 6/);
  });

  it('refuses a bad port name', () => {
    expect(portsProblems({ ports: { ...smoke, Admin: { port: 4000 } } })[0]).toMatch(/^ports\.Admin: /);
  });

  it('refuses a marker other than {{port}}', () => {
    const ports = { ...smoke, audit: { port: 3002, variables: { VITE_AUDIT_URL: 'http://{{host}}:{{port}}' } } };
    expect(portsProblems({ ports })).toEqual([
      'ports.audit.variables.VITE_AUDIT_URL: unknown marker {{host}} (only {{port}} is filled)',
    ]);
  });

  it('refuses the names that belong to the app and the reserved ones', () => {
    const named = (name: string) =>
      portsProblems({ ports: { ...smoke, api: { port: 3001, variables: { [name]: '{{port}}' } } } });
    expect(named('BUGDETECTIVE_API')[0]).toMatch(/^ports\.api\.variables\.BUGDETECTIVE_API: /);
    expect(named('PATH')[0]).toMatch(/^ports\.api\.variables\.PATH: /);
    expect(named('lower')[0]).toMatch(/^ports\.api\.variables\.lower: /);
  });

  it('refuses a variable two ports define', () => {
    const ports = { ...smoke, api: { port: 3001, variables: { CLIENT_ORIGIN: 'x{{port}}' } } };
    expect(portsProblems({ ports })[0]).toMatch(
      /^ports\.api\.variables\.CLIENT_ORIGIN: already defined by the port client/,
    );
  });

  it('refuses a port variable that a service already defines', () => {
    const services = { db: { image: 'postgres:17', variables: { DATABASE_URL: 'postgres://{{host}}:{{port}}/db' } } };
    const ports = { ...smoke, api: { port: 3001, variables: { DATABASE_URL: 'http://localhost:{{port}}' } } };
    expect(portsProblems({ ports, services })).toEqual([
      'ports.api.variables.DATABASE_URL: already defined by the service db',
    ]);
  });
});

describe('portVariables', () => {
  it('fills each port with its chosen one', () => {
    expect(portVariables(smoke, { client: 5180, api: 3001, audit: 49152 })).toEqual({
      CLIENT_ORIGIN: 'http://localhost:5180',
      VITE_AUDIT_URL: 'http://localhost:49152',
    });
  });

  it('throws when a port has no chosen one', () => {
    expect(() => portVariables(smoke, { client: 5180, api: 3001 })).toThrow(/audit/);
  });
});
